import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/routes/__tests__/**/*.test.ts'],
	},
})
