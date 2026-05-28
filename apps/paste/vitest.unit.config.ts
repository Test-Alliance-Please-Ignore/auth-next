import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/services/__tests__/**/*.test.ts'],
	},
})

