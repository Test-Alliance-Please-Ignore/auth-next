import { getConfig } from '@repo/eslint-config'

const config = getConfig(import.meta.url)

export default [
	...config,
	{
		// Root automation scripts are plain JS modules and not part of TS project service.
		files: ['scripts/**/*.mjs', 'decrypt-test.mjs'],
		languageOptions: {
			parserOptions: {
				projectService: false,
			},
			globals: {
				console: 'readonly',
				process: 'readonly',
			},
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'off',
			'no-undef': 'off',
		},
	},
	{
		// Turborepo generators use require() in template tooling.
		files: ['turbo/generators/config.ts'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
	{
		// Ignore path alias resolution issues in UI app (@/ aliases)
		files: ['apps/ui/**/*.{ts,tsx}'],
		rules: {
			'import/no-unresolved': 'off',
		},
	},
]
