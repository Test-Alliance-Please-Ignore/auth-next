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
					// The DISCORD binding targets the cross-worker `discord` Durable Object. Provide a
					// stub `discord` worker exposing a `Discord` DO so the pool can resolve the binding
					// at startup. Mailroom's tests never call the real DO — Discord is faked in the
					// notify-discord unit tests — this only satisfies the runtime.
					workers: [
						{
							name: 'discord',
							modules: true,
							script: [
								'export class Discord {',
								'  async sendMessage() { return { success: false, error: "stub discord worker" } }',
								'}',
								'export default { fetch() { return new Response("stub") } }',
							].join('\n'),
							durableObjects: { Discord: 'Discord' },
						},
					],
				},
			},
		},
	},
})
