import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [cloudflare({ inspectorPort: false })],
	build: {
		rollupOptions: {
			external: ['zlib-sync'],
		},
	},
})
