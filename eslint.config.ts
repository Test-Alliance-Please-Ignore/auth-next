import { getConfig } from '@repo/eslint-config'

const config = getConfig(import.meta.url)

export default [
	...config,
	{
		// Ignore path alias resolution issues in UI app (@/ aliases)
		files: ['apps/ui/**/*.{ts,tsx}'],
		rules: {
			'import/no-unresolved': 'off',
		},
	},
]
