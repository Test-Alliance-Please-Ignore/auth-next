import tsEslintParser from '@typescript-eslint/parser'
import eslintConfigPrettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react'
import { configs as reactHooksConfigs } from 'eslint-plugin-react-hooks'

import { defineConfig, getConfig } from './default.config'
import { getTsconfigRootDir } from './helpers'

import type { Linter } from 'eslint'

export function getReactConfig(importMetaUrl: string): Array<Linter.Config<Linter.RulesRecord>> {
	return defineConfig([
		getConfig(importMetaUrl),
		{
			files: ['**/*.{ts,tsx,mts,js,jsx,mjs,cjs}'],
			plugins: {
				react,
			},
			languageOptions: {
				parser: tsEslintParser,
				parserOptions: {
					ecmaFeatures: {
						jsx: true,
					},
					sourceType: 'module',
					projectService: true,
					tsconfigRootDir: getTsconfigRootDir(importMetaUrl),
				},
			},
		},
		// The plugin's runtime flat config uses the correct plugin map, but its
		// published declaration still describes the legacy string-array shape.
		reactHooksConfigs['recommended-latest'] as unknown as Linter.Config,

		// Prettier (should be last to override other formatting rules)
		{ rules: eslintConfigPrettier.rules },
	])
}
