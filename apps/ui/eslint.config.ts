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
]
