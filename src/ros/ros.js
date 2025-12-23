ROS = new (function () {
	var that = this;

	var os = require('os');
	var sys = require('sys');
	var { spawn, exec, execSync } = require('child_process')
	// var spawn = require('child_process').spawn;
	var python = 'python' + (process.env.ROS_PYTHON_VERSION != undefined ? process.env.ROS_PYTHON_VERSION : '');

	////////////////////////////////
	// BEGIN Python implementation
	var init_impl = `
import rclpy
import sys

rclpy.init()
node = rclpy.create_node('flexbe_app')

sys.stdout.flush()
sys.stdout.write(':'+node.get_namespace()+':connected')
sys.stdout.flush()

rclpy.spin(node)
	`;

	var get_package_paths = `
import json
import os
import pathlib
import subprocess
import sys

from ament_index_python.packages import get_packages_with_prefixes, get_package_share_directory
import xml.etree.ElementTree as ET

def check_for_relevance(pkg_name, pkg_root_path):
    # Check if package.xml exists in root
    package_xml_path = os.path.join(pkg_root_path, "package.xml")
    if not os.path.exists(package_xml_path):
        # Fallback to share path if we were passed an install path without package.xml at root (which shouldn't happen for src, but check share)
        package_xml_path = os.path.join(pkg_root_path, "share", pkg_name, "package.xml")

    if os.path.exists(package_xml_path):
        try:
            xml_tree = ET.parse(package_xml_path)
            root = xml_tree.getroot()
            pkg_export = root.find("export")
            if pkg_export:
                has_states = pkg_export.find("flexbe_states") is not None
                has_behaviors = pkg_export.find("flexbe_behaviors") is not None
                return has_states, has_behaviors
        except Exception as exc:
            pass

    return False, False

def find_source_paths(pkg_list):
    # Try to deduce workspace src root
    # We look for '/install/' in paths to find workspace root
    src_map = {}
    ws_roots = set()
    for _, path in pkg_list.items():
        if '/install/' in path:
            ws_root = path.split('/install/')[0]
            ws_roots.add(ws_root)
    
    for ws_root in ws_roots:
        src_root = os.path.join(ws_root, 'src')
        if os.path.exists(src_root):
             # Walk to find packages
             for root, dirs, files in os.walk(src_root):
                if 'package.xml' in files:
                    try:
                        tree = ET.parse(os.path.join(root, 'package.xml'))
                        name_node = tree.getroot().find('name')
                        if name_node is not None:
                            src_map[name_node.text] = root
                    except:
                        pass
    return src_map


def find_flexbe_packages():
    flexbe_packages = []
    
    try:
        pkg_list = get_packages_with_prefixes()
    except Exception as e:
        sys.stderr.write("Failed to get packages: " + str(e) + "\\n")
        return []

    try:
        src_map = find_source_paths(pkg_list)
        sys.stderr.write("Found " + str(len(src_map)) + " packages in source.\\n")
    except Exception as e:
        sys.stderr.write("Failed to find source paths: " + str(e) + "\\n")
        src_map = {}

    for pkg_name, pkg_path in pkg_list.items():
        # Prefer source path if available
        check_path = pkg_path
        if pkg_name in src_map:
            check_path = src_map[pkg_name]
            # sys.stderr.write("Checking source for " + pkg_name + " at " + check_path + "\\n")
        
        try:
            has_states, has_behaviors = check_for_relevance(pkg_name, check_path)
            
            # Fallback check for installed path if source check failed to find relevance (e.g. missing build items?)
            # Actually, check_for_relevance checks package.xml. If src has package.xml, it should be enough.
            
            if has_states or has_behaviors:
                final_path = check_path
                package = {"name": pkg_name, "path": final_path, "python_path": None}
                flexbe_packages.append(package)
                # sys.stderr.write("Added flexbe package: " + pkg_name + "\\n")
        except Exception as e:
             sys.stderr.write("Error checking package " + pkg_name + ": " + str(e) + "\\n")

    return flexbe_packages

if __name__ == "__main__":
    flexbe_packages = find_flexbe_packages()
    #-----------------------------------------------------------
    dump_path = os.path.join(str(pathlib.Path.home()), ".ros", "flexbe_package_list.txt")
    with open(dump_path, "wt") as dump:
            dump.write(json.dumps(flexbe_packages, sort_keys=True, indent=2))
    #-----------------------------------------------------------

    sys.stdout.write(json.dumps(flexbe_packages))
`;
	// END Python implementation
	//////////////////////////////

	var ros_proc = undefined;

	that.init = function (callback) {
		ros_proc = spawn(python, ['-c', init_impl]);
		ros_proc.stdout.on('data', data => {
			data = String(data);
			if (data.endsWith("connected")) {
				var data_segments = data.split(':');
				var ros_namespace = data_segments[data_segments.length - 2];
				callback(ros_namespace);
			}
		});
		ros_proc.stderr.on('data', data => {
			T.logError("ROS connection error: " + data);
			ros_proc.kill('SIGKILL');
			callback(undefined);
		});

		ros_proc = exec(python + " -c " + init_impl, function (err, stdout, stderr) {
			if (err || stderr) {
				T.logError("ROS connection error: " + data);
				ros_proc.kill('SIGKILL');
				callback(undefined);
			}
			console.log(stdout);
		});
	}

	that.shutdown = function () {
		if (ros_proc != undefined) {
			ros_proc.kill('SIGKILL');
		}
	}

	var package_cache = undefined;
	that.getPackageList = function (callback) {
		if (package_cache == undefined) {
			var get_pkg = undefined;
			let package_data = '';
			let packages = []

			T.logInfo("  Request FlexBE compatible package list from ROS ...");
			get_pkg = spawn(python, ['-c', get_package_paths])

			get_pkg.stdout.on('data', data => {
				package_data += data;
			});

			get_pkg.stderr.on('data', data => {
				T.logError(data);
			});
			get_pkg.on('close', (code) => {
				T.logInfo(" Processing FlexBE compatible package list ...");
				try {
					package_cache = JSON.parse(package_data);
				} catch (err) {
					T.logError(err.toString());
					T.logError(" ros.js:: JSON error -->\n" + data);
					throw err;
				}

				T.logInfo(" Found " + package_cache.length + " FlexBE compatible packages.");
				for (let i = 0; i < package_cache.length; i++) {
					package_cache[i].python_path = undefined
					T.logInfo("  " + package_cache[i].name + " -->" + package_cache[i].path)
				}
				callback(package_cache.clone())
			});

		} else {
			process.nextTick(() => {
				callback(package_cache.clone());
			});
		}
	}

	that.getPackagePath = function (package_name, callback) {
		that.getPackageList((package_cache) => {
			var package_path = undefined;
			for (var i = 0; i < package_cache.length; i++) {
				if (package_cache[i]['name'] == package_name) {
					package_path = package_cache[i]['path'];
					break;
				}
			}
			callback(package_path);
		});
	}

	that.getPackagePythonPath = function (package_name, callback) {
		var python_path = undefined;
		var temp_package_path = undefined;
		T.logInfo("[PYTHON_PATH DEBUG] Getting python_path for package: " + package_name);
		that.getPackageList((package_cache) => {
			for (var i = 0; i < package_cache.length; i++) {
				if (package_cache[i]['name'] == package_name) {
					python_path = package_cache[i]['python_path'];
					break;
				}
			}
			if (python_path !== undefined) {
				T.logInfo("[PYTHON_PATH DEBUG] Found cached python_path for " + package_name + ": " + python_path);
				process.nextTick(() => {
					callback(python_path);
				});
			} else {
				T.logInfo("[PYTHON_PATH DEBUG] No cached python_path for " + package_name + ", running Python script...");
				var get_src_path_script = `
import importlib
import os
import sys
import xml.etree.ElementTree as ET

pkg_name = '` + package_name + `'
found_path = ""

try:
    # 1. Get install path as fallback
    mod = importlib.import_module(pkg_name)
    install_path = mod.__path__[0] # list
    found_path = install_path # Default to install path
    
    # 2. Find workspace root
    if '/install/' in install_path:
        ws_root = install_path.split('/install/')[0]
        src_root = os.path.join(ws_root, 'src')
        
        # 3. Search src for package
        source_pkg_path = None
        if os.path.exists(src_root):
             for root, dirs, files in os.walk(src_root):
                if 'package.xml' in files:
                    try: 
                        tree = ET.parse(os.path.join(root, 'package.xml'))
                        root_node = tree.getroot()
                        name_node = root_node.find('name')
                        if name_node is not None and name_node.text == pkg_name:
                             source_pkg_path = root
                             break
                    except:
                        pass
        
        if source_pkg_path:
             # 4. Find python module in source
             # Check for src/pkg_name or pkg_name (ROS 2 python package structures)
             possible_paths = [
                 os.path.join(source_pkg_path, pkg_name),
                 os.path.join(source_pkg_path, 'src', pkg_name) # ROS 2 pure python pkg structure
             ]
             for p in possible_paths:
                 if os.path.isdir(p) and os.path.exists(os.path.join(p, '__init__.py')):
                     found_path = p
                     break
except Exception as e:
    pass

print(found_path, end='')
`;
				var proc = spawn(python, ['-c', get_src_path_script]);
				var path_data = '';
				proc.stdout.on('data', data => {
					path_data += data;
				});
				proc.stderr.on('data', data => {
					console.log(package_name + " failed to import: " + data);
				});
				proc.on('close', (code) => {
					T.logInfo("[PYTHON_PATH DEBUG] Python script finished for " + package_name + " with code " + code + ", result: '" + path_data + "'");
					if (path_data != "") {
						python_path = path_data.replace(/\n/g, '');
						T.logInfo("[PYTHON_PATH DEBUG] Setting python_path for " + package_name + ": " + python_path);
						for (var i = 0; i < package_cache.length; i++) {
							if (package_cache[i]['name'] == package_name) {
								package_cache[i]['python_path'] = python_path;
								break;
							}
						}
						callback(python_path);
					} else {
						T.logWarn("[PYTHON_PATH DEBUG] Empty python_path for " + package_name + ", calling callback with undefined");
						callback(undefined);
					}
				});
			}
		});
	}

	that.getParam = function (name, callback) {
		var proc = spawn('ros2', ['param', 'get', name]);
		proc.stdout.on('data', data => {
			proc.kill('SIGKILL');
			if (String(data).startsWith('ERROR')) {
				callback(undefined);
			} else {
				callback(JSON.parse(data));
			}
		});
	}

})();
