import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [cloudflare({ inspectorPort: false })],
	resolve: {
		alias: {
			'@repo/inventory-display': path.resolve(
				__dirname,
				'../../packages/inventory-display/src/index.ts'
			),
		},
	},
})
