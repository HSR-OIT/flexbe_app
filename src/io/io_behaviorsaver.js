IO.BehaviorSaver = new (function () {
	var that = this;

	var path = require('path');

	var storeBehaviorCode = function (generated_code, callback) {
		var create_callback = function (folder) {
			IO.Filesystem.createFile(folder, names.file_name, generated_code, function () {
				callback();
			});
		};
		var names = Behavior.createNames();
		var package_name = names.rosnode_name;
		ROS.getPackagePythonPath(package_name, (folder_path) => {
			var file_path = path.join(folder_path, names.file_name);
			var file_tmp_path = path.join(folder_path, names.file_name_tmp);
			if (RC.Controller.isConnected()) {
				IO.Filesystem.checkFileExists(folder_path, names.file_name_tmp, function (tmp_exists) {
					if (!tmp_exists) {
						IO.Filesystem.checkFileExists(folder_path, names.file_name_tmp, function (src_exists) {
							if (src_exists) {
								IO.Filesystem.getFileContent(folder_path, names.file_name, function (content_onboard) {
									IO.Filesystem.createFile(folder_path, names.file_name_tmp, content_onboard, function () {
										create_callback(folder_path);
									});
								});
							} else {
								create_callback(folder_path);
							}
						});
					} else {
						create_callback(folder_path);
					}
				});
			} else {
				create_callback(folder_path);
			}

		});
	}

	var storeBehaviorManifest = function (generated_manifest, callback) {
		var names = Behavior.createNames();
		var package_name = names.rosnode_name;

		// Attempt to resolve source path for manifest
		ROS.getPackagePythonPath(package_name, (python_path) => {
			var folder_path = undefined;
			if (python_path != undefined) {
				// python_path points to the package module (e.g. src/repo/pkg/pkg).
				// We assume manifest is at src/repo/pkg/manifest
				// So we go up one level from python_path and add 'manifest'
				folder_path = path.join(path.dirname(python_path), 'manifest');
			} else if (names.manifest_path != undefined) {
				folder_path = path.dirname(names.manifest_path);
			} else {
				// Fallback to finding package path (likely install)
				ROS.getPackagePath(package_name, (package_path) => {
					folder_path = path.join(package_path, 'lib', package_name, 'manifest');
				});
			}

			if (folder_path != undefined) {
				IO.Filesystem.createFile(folder_path, names.manifest_name, generated_manifest, function () {
					callback();
				});
			} else {
				// Should not happen if ROS.getPackagePath works, but handled async above
				// Need to handle async flow correctly.
				// Refactoring to ensure async getPackagePath is called if needed.
				// But simpler: just nest logic.
			}
		});
	}

	// REDEFINED due to async complexity above
	var storeBehaviorManifest = function (generated_manifest, callback) {
		var names = Behavior.createNames();
		var package_name = names.rosnode_name;

		ROS.getPackagePythonPath(package_name, (python_path) => {
			if (python_path) {
				// Save to source
				var folder_path = path.join(path.dirname(python_path), 'manifest');
				IO.Filesystem.createFile(folder_path, names.manifest_name, generated_manifest, function () {
					callback();
				});
			} else {
				// Save to original location or install location
				if (names.manifest_path != undefined) {
					var folder_path = path.dirname(names.manifest_path);
					var file_name = path.basename(names.manifest_path);
					IO.Filesystem.createFile(folder_path, file_name, generated_manifest, function () {
						callback();
					});
				} else {
					ROS.getPackagePath(package_name, (package_path) => {
						var folder_path = path.join(package_path, 'lib', package_name, 'manifest');
						IO.Filesystem.createFile(folder_path, names.manifest_name, generated_manifest, function () {
							callback();
						});
					});
				}
			}
		});
	}

	var saveSuccessCallback = function () {
		T.logInfo("Save successful!");
		UI.Panels.Terminal.hide();
		UI.Settings.updateBehaviorlib();
		UI.Tools.notifyRosCommand('save');
	}


	this.saveStateMachine = function () {
		T.clearLog();
		UI.Panels.Terminal.show();

		IO.BehaviorLoader.updateManualSections(() => {
			// generate sourcecode
			var generated_code = "";
			try {
				generated_code = IO.CodeGenerator.generateBehaviorCode();
				T.logInfo("Code generation completed.");
			} catch (err) {
				T.logError("Code generation failed: " + err);
				return;
			}

			// generate manifest
			var generated_manifest = "";
			try {
				generated_manifest = IO.ManifestGenerator.generateManifest();
				T.logInfo("Manifest generation completed.");
			} catch (err) {
				T.logError("Manifest generation failed: " + err);
				return;
			}

			// store in file
			storeBehaviorCode(generated_code, () => {
				// make sure code file exists before creating the manifest
				// this reduces the risk for orphan manifests
				storeBehaviorManifest(generated_manifest, () => {
					saveSuccessCallback();
				});
			});
		});
	}

})();
