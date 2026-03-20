export interface TaxProjectionDispatchDependencies {
	trigger: () => Promise<void>
	clearRetryIntent: () => Promise<void>
	recordRetryIntent: (errorMessage: string) => Promise<void>
}

export type TaxProjectionDispatchResult =
	| { outcome: 'skipped' }
	| { outcome: 'triggered' }
	| { outcome: 'trigger_failed'; errorMessage: string }

/**
 * Dispatch tax projection refresh for wallet-sync deltas.
 * Ensures exactly one trigger attempt for each dispatch call.
 */
export async function dispatchTaxProjectionRefresh(args: {
	shouldTrigger: boolean
	deps: TaxProjectionDispatchDependencies
}): Promise<TaxProjectionDispatchResult> {
	if (!args.shouldTrigger) {
		return { outcome: 'skipped' }
	}

	try {
		await args.deps.trigger()
		await args.deps.clearRetryIntent()
		return { outcome: 'triggered' }
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		await args.deps.recordRetryIntent(errorMessage)
		return {
			outcome: 'trigger_failed',
			errorMessage,
		}
	}
}
