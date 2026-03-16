import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
	plugins: [
		command === 'serve'
			? cloudflare({
					inspectorPort: false,
					auxiliaryWorkers: [
						{ configPath: '../eve-token-store/wrangler.jsonc' },
						{ configPath: '../groups/wrangler.jsonc' },
						{ configPath: '../hr/wrangler.jsonc' },
					],
				})
			: cloudflare(),
	],
	server: {
		host: '127.0.0.1',
		port: 8787,
		strictPort: true,
	},
	build: {
		rollupOptions: {
			external: ['zlib-sync'],
		},
	},
}))
