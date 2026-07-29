import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";

export default defineConfig([
	// Replaces .eslintignore, which flat config no longer reads.
	globalIgnores(["node_modules/", "main.js", "test-vault/", "coverage/"]),
	js.configs.recommended,
	tseslint.configs.eslintRecommended,
	tseslint.configs.recommended,
	{
		files: ["**/*.ts", "**/*.mjs"],
		languageOptions: {
			sourceType: "module",
			globals: globals.node,
		},
		rules: {
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
		},
	},
]);
