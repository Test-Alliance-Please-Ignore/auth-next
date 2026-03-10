import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/client'),
		},
	},
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
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
		},
	},
})
