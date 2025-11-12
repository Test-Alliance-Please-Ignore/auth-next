import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				miniflare: {
					compatibilityDate: '2025-03-07',
					compatibilityFlags: ['nodejs_compat'],
					bindings: {
						ENVIRONMENT: 'VITEST',
					},
					durableObjects: {
						UNIVERSE: 'UniverseDO',
					},
				},
			},
		},
	},
})
