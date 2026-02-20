/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			include: ["src/**/*.ts"],
			exclude: [
				"src/plugin.ts",
				"src/**/*.test.ts",
				"src/**/*.spec.ts",
				"src/**/index.ts"
			],
			thresholds: {
				branches: 80,
				functions: 80,
				lines: 80,
				statements: 80
			}
		}
	}
});
