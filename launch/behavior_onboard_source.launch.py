# Copyright 2026
#
# Launch flexbe_onboard with workspace source Python packages before install-space
# packages, so behavior execution uses the same files FlexBE App edits.

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription, SetEnvironmentVariable
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration

from ament_index_python.packages import get_package_share_directory, get_packages_with_prefixes

import os
import xml.etree.ElementTree as ET


def _workspace_root_from_prefix(path):
    normalized = os.path.normpath(path)
    parts = normalized.split(os.sep)
    if "install" not in parts:
        return None
    install_index = parts.index("install")
    if install_index == 0:
        return None
    return os.sep.join(parts[:install_index]) or os.sep


def _source_python_paths():
    paths = []
    seen = set()
    ws_roots = set()

    for prefix in get_packages_with_prefixes().values():
        ws_root = _workspace_root_from_prefix(prefix)
        if ws_root is not None:
            ws_roots.add(ws_root)

    for ws_root in sorted(ws_roots):
        src_root = os.path.join(ws_root, "src")
        if not os.path.isdir(src_root):
            continue

        for root, _, files in os.walk(src_root):
            if "package.xml" not in files:
                continue

            try:
                pkg_xml = ET.parse(os.path.join(root, "package.xml"))
                name_node = pkg_xml.getroot().find("name")
            except Exception:
                continue

            if name_node is None or not name_node.text:
                continue

            pkg_name = name_node.text
            candidates = [
                (os.path.join(root, pkg_name), root),
                (os.path.join(root, "src", pkg_name), os.path.join(root, "src")),
            ]
            for module_path, import_root in candidates:
                if os.path.isfile(os.path.join(module_path, "__init__.py")) and import_root not in seen:
                    seen.add(import_root)
                    paths.append(import_root)

    return paths


def generate_launch_description():
    flexbe_onboard_dir = get_package_share_directory("flexbe_onboard")
    source_python_paths = _source_python_paths()
    pythonpath = os.pathsep.join(source_python_paths + [os.environ.get("PYTHONPATH", "")])

    return LaunchDescription([
        SetEnvironmentVariable("PYTHONPATH", pythonpath),

        DeclareLaunchArgument("log_enabled", default_value="False"),
        DeclareLaunchArgument("log_folder", default_value="~/.flexbe_logs"),
        DeclareLaunchArgument("log_serialize", default_value="yaml"),
        DeclareLaunchArgument("log_level", default_value="INFO"),
        DeclareLaunchArgument("use_sim_time", default_value="False"),
        DeclareLaunchArgument("enable_clear_imports", default_value="False",
                              description="Delete behavior-specific module imports after execution."),

        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(flexbe_onboard_dir + "/behavior_onboard.launch.py"),
            launch_arguments={
                "log_enabled": LaunchConfiguration("log_enabled"),
                "log_folder": LaunchConfiguration("log_folder"),
                "log_serialize": LaunchConfiguration("log_serialize"),
                "log_level": LaunchConfiguration("log_level"),
                "enable_clear_imports": LaunchConfiguration("enable_clear_imports"),
                "use_sim_time": LaunchConfiguration("use_sim_time"),
            }.items()
        )
    ])
