import { defineConfig, getConfig } from '@repo/eslint-config'

import type { Config } from '@repo/eslint-config'

const config = getConfig(import.meta.url)

export default defineConfig([
	config,
	{
		ignores: ['vite.config.ts', 'vitest.config.ts', 'vitest.unit.config.ts'],
	},
]) as Config
