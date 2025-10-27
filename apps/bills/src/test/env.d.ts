declare module 'cloudflare:test' {
	// ProvidedEnv controls the type of `import("cloudflare:test").env`
	interface ProvidedEnv extends Env {
		DATABASE_URL: string
		BILLS: DurableObjectNamespace<Bills>
		BILLS_SCHEDULE_EXECUTOR: DurableObjectNamespace
		NEON_API_KEY: string
		NEON_PROJECT_ID: string
	}

	// export const SELF: DurableObjectStub<import('../../durable-object').BillsDO>
}
