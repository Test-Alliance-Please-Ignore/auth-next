declare module 'cloudflare:test' {
	// ProvidedEnv controls the type of `import("cloudflare:test").env`
	interface ProvidedEnv extends Env {
		DATABASE_URL: string
		INDUSTRY: DurableObjectNamespace<Industry>
	}
}
