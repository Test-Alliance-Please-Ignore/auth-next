import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		name: 'eve-corporation-data-unit',
		environment: 'node',
		include: ['src/test/unit/workflows/wallet-fanout.test.ts'],
	},
})
