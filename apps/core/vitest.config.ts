import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `./wrangler.test.jsonc` },
		}),
	],

	test: {
		include: [
			'src/routes/__tests__/groups.admins.route.test.ts',
			'src/routes/__tests__/groups.mumble-sync.route.test.ts',
			'src/routes/__tests__/hr.application-alerts.test.ts',
		],
	},
})
