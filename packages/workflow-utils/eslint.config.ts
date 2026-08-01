import { defineConfig, getConfig } from '@repo/eslint-config'

import type { Config } from '@repo/eslint-config'

const config = getConfig(import.meta.url)

export default defineConfig([
	config,
	{
		files: ['vitest.config.ts'],
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ['vitest.config.ts'],
				},
			},
		},
	},
]) as Config
