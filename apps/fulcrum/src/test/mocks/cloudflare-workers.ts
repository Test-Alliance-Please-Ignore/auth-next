export class DurableObject {
	protected readonly ctx: unknown
	protected readonly env: unknown

	constructor(ctx: unknown, env: unknown) {
		this.ctx = ctx
		this.env = env
	}
}

export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
	protected readonly ctx: unknown
	protected readonly env: Env

	constructor(ctx: unknown, env: Env) {
		this.ctx = ctx
		this.env = env
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	async run(_event: unknown, _step: unknown): Promise<Params> {
		throw new Error('WorkflowEntrypoint.run is not implemented in unit-test shim')
	}
}

export class NonRetryableError extends Error {}
