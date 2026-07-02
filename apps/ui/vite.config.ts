import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [cloudflare({ inspectorPort: false }), react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/client'),
			'@repo/alert-destinations': path.resolve(__dirname, '../../packages/alert-destinations/src/index.ts'),
			'@repo/inventory-display': path.resolve(__dirname, '../../packages/inventory-display/src/index.ts'),
		},
	},
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
		// Proxy server-side auth/invite routes to the core worker during development.
		proxy: {
			'/api': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
			},
			'/login': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
			},
			'/invite': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
			},
			'/images': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
			},
		},
	},
})
