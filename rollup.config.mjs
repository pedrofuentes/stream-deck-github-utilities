import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatch = !!process.env.ROLLUP_WATCH;
const sdPluginDir = "com.pedrofuentes.github-utilities.sdPlugin";

/**
 * @type {import("rollup").RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPluginDir}/bin/plugin.js`,
		format: "es",
		sourcemap: isWatch,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		}
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPluginDir}/manifest.json`);
			}
		},
		typescript(),
		resolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true
		})
	],
	external: [/^@elgato\//, /^ws$/, /^node:/]
};

export default config;
