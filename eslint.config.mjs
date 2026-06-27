// @ts-check
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import globals from "globals"

// Flat config (ESLint 9). Faithful port of the previous .eslintrc: eslint-recommended +
// typescript-eslint recommended (NOT type-checked) plus the project's custom rules.
export default tseslint.config(
	{
		ignores: ["dist/**", "prod/**", "node_modules/**", "build/**", "dev/**", "docs/**", ".vscode/**"]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["src/**/*.{js,jsx,ts,tsx}"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		},
		rules: {
			eqeqeq: "error",
			quotes: ["error", "double"],
			"no-mixed-spaces-and-tabs": "off",
			"no-duplicate-imports": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_"
				}
			]
		}
	},
	{
		// Dev-only CommonJS entry shims (index.dev.js, worker.dev.js) use require() by design.
		files: ["**/*.{js,cjs}"],
		rules: {
			"@typescript-eslint/no-require-imports": "off"
		}
	}
)
