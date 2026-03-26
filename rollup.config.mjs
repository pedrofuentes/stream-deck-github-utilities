import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";
import fs from "node:fs";

const isWatch = !!process.env.ROLLUP_WATCH;
const pluginSrcDir = "plugin";
const sdPluginDir = "release/com.pedrofuentes.github-utilities.sdPlugin";

/**
 * Recursively copies a directory, creating the destination if needed.
 * @param {string} src - Source directory path.
 * @param {string} dest - Destination directory path.
 */
function copyDirSync(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * @type {import("rollup").RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPluginDir}/bin/plugin.js`,
		format: "es",
		inlineDynamicImports: true,
		sourcemap: isWatch,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			name: "copy-plugin-assets",
			buildStart: function () {
				// Watch source plugin assets for changes
				this.addWatchFile(`${pluginSrcDir}/manifest.json`);
			},
			generateBundle() {
				// Copy all source plugin assets to the release sdPlugin directory
				copyDirSync(pluginSrcDir, sdPluginDir);
			}
		},
		typescript(),
		resolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		}),
		commonjs()
	],
	external: [/^node:/, "isomorphic-git"]
};

export default config;
