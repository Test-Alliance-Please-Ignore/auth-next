import baseConfig from '@repo/eslint-config/base'

export default [
	...baseConfig,
	{
		languageOptions: {
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
]
