import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

import { findAuxiliaryWorkers } from '@repo/vite-config'

const currentDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command }) => ({
	plugins: [
		command === 'serve'
			? cloudflare({
					configPath: 'wrangler.jsonc',
					inspectorPort: false,
					auxiliaryWorkers: findAuxiliaryWorkers(currentDir),
				})
			: cloudflare({ configPath: 'wrangler.jsonc' }),
	],
	server: {
		host: '127.0.0.1',
		port: 8787,
		strictPort: true,
	},
}))
