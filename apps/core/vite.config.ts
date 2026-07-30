import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

import { findAuxiliaryWorkers } from '@repo/vite-config'

const currentDir = dirname(fileURLToPath(import.meta.url))
const disableAuxWorkers = process.env.LOCAL_DEV_DISABLE_AUXILIARY_WORKERS === '1'

function getLocalDevAllowedHosts(): string[] {
	return (process.env.LOCAL_DEV_ALLOWED_HOSTS ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => {
			try {
				return new URL(value.includes('://') ? value : `http://${value}`).hostname
			} catch {
				return value
			}
		})
}

const localDevAllowedHosts = getLocalDevAllowedHosts()

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
		port: 8787,
		strictPort: true,
		...(localDevAllowedHosts.length > 0 ? { allowedHosts: localDevAllowedHosts } : {}),
	},
	build: {
		rollupOptions: {
			external: ['zlib-sync'],
		},
	},
}))
