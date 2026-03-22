import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/client'),
			'@mantine/core': path.resolve(__dirname, './node_modules/@mantine/core'),
			'@mantine/dates': path.resolve(__dirname, './node_modules/@mantine/dates'),
			'@mantine/hooks': path.resolve(__dirname, './node_modules/@mantine/hooks'),
			'mantine-react-table': path.resolve(__dirname, './node_modules/mantine-react-table'),
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
			'/images': {
				target: 'http://127.0.0.1:8787',
				changeOrigin: true,
			},
		},
	},
})
