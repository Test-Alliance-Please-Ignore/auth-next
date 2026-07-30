import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
		...(localDevAllowedHosts.length > 0 ? { allowedHosts: localDevAllowedHosts } : {}),
		// Proxy server-side auth/invite routes to the core worker during development.
		proxy: {
			'/api/discord/interactions': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
			},
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
