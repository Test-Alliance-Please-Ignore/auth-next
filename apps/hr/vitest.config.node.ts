import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		name: 'hr-unit',
		environment: 'node',
		include: ['src/test/unit/**/*.test.ts'],
	},
})
