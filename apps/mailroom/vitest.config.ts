import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		name: 'mailroom',
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
					},
					// The DISCORD and PREDICTION_MARKETS bindings target cross-worker Durable Objects
					// (`discord` / `prediction-markets`). Provide stub workers exposing those DO classes so
					// the pool can resolve the bindings at startup. Mailroom's tests never call the real DOs
					// — both are faked in the unit tests (envWith) — these only satisfy the runtime.
					workers: [
						{
							name: 'discord',
							modules: true,
							script: [
								'export class Discord {',
								'  async sendMessage() { return { success: false, error: "stub discord worker" } }',
								'  async getProfileByCoreUserId() { return null }',
								'}',
								'export default { fetch() { return new Response("stub") } }',
							].join('\n'),
							durableObjects: { Discord: 'Discord' },
						},
						{
							name: 'prediction-markets',
							modules: true,
							script: [
								'export class PredictionMarkets {',
								'  async awardRandomBonus() { return { awarded: false, reason: "NO_ELIGIBLE_WALLETS" } }',
								'}',
								'export default { fetch() { return new Response("stub") } }',
							].join('\n'),
							durableObjects: { PredictionMarkets: 'PredictionMarkets' },
						},
					],
				},
			},
		},
	},
})
