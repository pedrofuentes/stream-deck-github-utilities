/**
 * Converts SVG files in content/assets/ to PNG using @resvg/resvg-js.
 *
 * Usage: npx tsx scripts/convert-content-assets.ts
 *
 * Reads all .svg files from content/assets/, converts each to PNG at native
 * viewBox dimensions, and writes the PNG alongside the SVG. Logs filename,
 * dimensions, and file size for each output. Validates against Elgato Marketplace
 * size limits.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const ASSETS_DIR = join(import.meta.dirname, "..", "content", "assets");

/** Elgato Marketplace file size limits in bytes */
const SIZE_LIMITS: Record<string, number> = {
	icon: 2 * 1024 * 1024,       // 2 MB
	thumbnail: 5 * 1024 * 1024,  // 5 MB
	gallery: 10 * 1024 * 1024,   // 10 MB
};

function getSizeLimit(filename: string): { limit: number; label: string } {
	if (filename.startsWith("icon")) return { limit: SIZE_LIMITS.icon, label: "2 MB" };
	if (filename.startsWith("thumbnail")) return { limit: SIZE_LIMITS.thumbnail, label: "5 MB" };
	return { limit: SIZE_LIMITS.gallery, label: "10 MB" };
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function main(): void {
	const files = readdirSync(ASSETS_DIR).filter((f) => extname(f).toLowerCase() === ".svg");

	if (files.length === 0) {
		console.log("No SVG files found in content/assets/");
		return;
	}

	console.log(`\nConverting ${files.length} SVG file(s) to PNG...\n`);

	let allPassed = true;

	for (const file of files) {
		const svgPath = join(ASSETS_DIR, file);
		const pngName = basename(file, extname(file)) + ".png";
		const pngPath = join(ASSETS_DIR, pngName);

		const svgData = readFileSync(svgPath, "utf-8");

		const resvg = new Resvg(svgData, {
			fitTo: { mode: "original" },
			font: {
				loadSystemFonts: true,
			},
		});

		const rendered = resvg.render();
		const pngBuffer = rendered.asPng();

		writeFileSync(pngPath, pngBuffer);

		const { limit, label } = getSizeLimit(file);
		const sizeOk = pngBuffer.length <= limit;
		const status = sizeOk ? "✓" : "✗ OVER LIMIT";

		if (!sizeOk) allPassed = false;

		console.log(
			`  ${status}  ${pngName.padEnd(40)} ${rendered.width}×${rendered.height}    ${formatBytes(pngBuffer.length).padStart(10)}  (limit: ${label})`
		);
	}

	console.log("");

	if (!allPassed) {
		console.error("⚠  Some files exceed Elgato Marketplace size limits. Optimize the SVGs or reduce complexity.");
		process.exit(1);
	}

	console.log("All PNGs generated and within size limits.");
}

main();
