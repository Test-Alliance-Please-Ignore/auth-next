import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [
		cloudflare(),
		react(),
	],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/client'),
		},
	},
	server: {
		// Proxy API requests to the core worker during development
		proxy: {
			'/api': {
				target: 'http://localhost:8787',
				changeOrigin: true,
			},
		},
	},
})
