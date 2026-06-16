import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";

/**
 * ESLint v9 flat configuration.
 *
 * Lints the TypeScript plugin source in `src/` using the ESLint and
 * typescript-eslint recommended rule sets, plus a few project-specific
 * conventions documented in AGENTS.md (no unused vars/params, double quotes).
 */
export default [
	{
		ignores: [
			"release/**",
			"coverage/**",
			"node_modules/**",
			"**/*.test.ts",
			"**/*.spec.ts",
		],
	},
	js.configs.recommended,
	...tseslint.configs["flat/recommended"],
	{
		files: ["**/*.ts"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			globals: {
				...globals.node,
			},
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
];
