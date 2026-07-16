/**
 * Workflow instance creation with a default retention policy.
 *
 * Retention is INSTANCE-level: it is set per `create()` / per `createBatch()` entry and
 * governs how long a finished run's state (step outputs, status, per-step failure records)
 * and logs survive. There is no step-level equivalent — `WorkflowStepConfig` carries only
 * `retries` and `timeout`, and there is no wrangler.jsonc or account-level setting.
 *
 * Create every instance through `createWorkflow` / `createWorkflowBatch` rather than calling
 * `binding.create()` directly, so the policy stays applied as new call sites are added.
 */

/**
 * Retention duration, string form only.
 *
 * The platform also accepts a bare `number`, but it is MILLISECONDS — `3600` is one hour,
 * not one second. Neither the type system nor CI would catch that, so the number branch of
 * `WorkflowRetentionDuration` is excluded here deliberately.
 */
export type RetentionDuration = Extract<WorkflowRetentionDuration, string>

export interface WorkflowRetentionPolicy {
	successRetention: RetentionDuration
	errorRetention: RetentionDuration
}

/**
 * Retention applied to every instance created through this module.
 *
 * The account plan sets only the ceiling (30 days on Paid); per-instance retention can
 * shorten it, never extend it.
 *
 * `successRetention: '1 hour'` clears the longest read-back window in this repo by ~4x:
 * apps/core persists a USER_REFRESH_WORKFLOW instance id and a later cron tick reads its
 * status back, bounded by that Durable Object's 15 minute pending TTL. Not lower: no
 * minimum is documented, the REST schema declares no floor, and miniflare ignores
 * `retention` entirely — so `wrangler dev` and every vitest-pool-workers test here are
 * blind to this field, and a shorter value cannot be validated before deploy.
 *
 * `errorRetention: '7 days'` matches the Workers Logs window. Retained error state is
 * currently the only per-step failure attribution that exists, because no workflow in this
 * repo reports to Sentry (`withSentry` wraps the Hono app; workflow classes are exported
 * outside it). Shorten only once workflow errors reach Sentry.
 */
export const DEFAULT_WORKFLOW_RETENTION = {
	successRetention: '1 hour',
	errorRetention: '7 days',
} as const satisfies WorkflowRetentionPolicy

/**
 * Options for {@link createWorkflow} / {@link createWorkflowBatch}.
 *
 * Identical to `WorkflowInstanceCreateOptions` except that `retention` is partial and is
 * merged over {@link DEFAULT_WORKFLOW_RETENTION}. Override only when a specific reader
 * needs a longer window than the default.
 */
export type CreateWorkflowOptions<PARAMS = unknown> = Omit<
	WorkflowInstanceCreateOptions<PARAMS>,
	'retention'
> & {
	retention?: Partial<WorkflowRetentionPolicy>
}

/**
 * Resolve each field independently so an explicitly-passed `undefined` falls back to the
 * default rather than clearing it (which the platform reads as unset, i.e. 30 days).
 */
function withDefaultRetention<PARAMS>(
	options: CreateWorkflowOptions<PARAMS>
): WorkflowInstanceCreateOptions<PARAMS> {
	const { retention, ...rest } = options
	return {
		...rest,
		retention: {
			successRetention: retention?.successRetention ?? DEFAULT_WORKFLOW_RETENTION.successRetention,
			errorRetention: retention?.errorRetention ?? DEFAULT_WORKFLOW_RETENTION.errorRetention,
		},
	}
}

/**
 * Create a Workflow instance with the default retention policy applied.
 *
 * @param workflow - The Workflow binding, e.g. `env.USER_REFRESH_WORKFLOW`
 * @param options - Standard create options; `retention` is merged over the default
 *
 * @example
 * ```typescript
 * const instance = await createWorkflow(env.USER_REFRESH_WORKFLOW, {
 *   id: workflowId,
 *   params: { userId },
 * })
 * ```
 */
export async function createWorkflow<PARAMS = unknown>(
	workflow: Workflow<PARAMS>,
	options: CreateWorkflowOptions<PARAMS> = {}
): Promise<WorkflowInstance> {
	return workflow.create(withDefaultRetention(options))
}

/**
 * Create a batch of Workflow instances with the default retention policy applied to each.
 *
 * Retention has no batch-level form — `createBatch` takes the same per-entry options as
 * `create`, so the policy is applied to every element.
 *
 * @param workflow - The Workflow binding, e.g. `env.BILL_DISCORD_NOTIFY`
 * @param batch - Per-instance create options; limited to 100 instances per call
 *
 * @example
 * ```typescript
 * const instances = await createWorkflowBatch(env.BILL_DISCORD_NOTIFY,
 *   bills.map((bill) => ({ params: { billId: bill.id } }))
 * )
 * ```
 */
export async function createWorkflowBatch<PARAMS = unknown>(
	workflow: Workflow<PARAMS>,
	batch: CreateWorkflowOptions<PARAMS>[]
): Promise<WorkflowInstance[]> {
	return workflow.createBatch(batch.map((options) => withDefaultRetention(options)))
}
