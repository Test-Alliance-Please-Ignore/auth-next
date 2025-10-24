import { getConfig } from '@repo/eslint-config'

const config = getConfig(import.meta.url)

export default [
	...config,
	{
		files: ['**/*.{ts,tsx}'],
		rules: {
			// Ignore path alias resolution issues (@/ aliases)
			'import/no-unresolved': 'off',
		},
	},
	{
		files: ['src/client/lib/api.ts'],
		rules: {
			// import.meta.env.PROD is a Vite built-in, not a Turbo env var
			'turbo/no-undeclared-env-vars': 'off',
		},
	},
	{
		// Don't lint config files that aren't part of the main project
		ignores: ['env.d.ts', 'vite.config.ts', 'vitest.config.ts', 'tailwind.config.ts'],
	},
]
