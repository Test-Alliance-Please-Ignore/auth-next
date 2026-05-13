import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

import { findAuxiliaryWorkers } from '@repo/vite-config'

const currentDir = dirname(fileURLToPath(import.meta.url))
const disableAuxWorkers = process.env.LOCAL_DEV_DISABLE_AUXILIARY_WORKERS === '1'

export default defineConfig(({ command }) => ({
	plugins: [
		command === 'serve'
			? cloudflare({
					configPath: 'wrangler.jsonc',
					inspectorPort: false,
					auxiliaryWorkers: disableAuxWorkers ? [] : findAuxiliaryWorkers(currentDir),
				})
			: cloudflare({ configPath: 'wrangler.jsonc' }),
	],
	server: {
		host: '127.0.0.1',
		port: 8788,
		strictPort: true,
	},
}))
