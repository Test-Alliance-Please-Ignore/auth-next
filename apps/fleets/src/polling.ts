/**
 * Compute next polling delay from baseline cadence and ESI cache guidance.
 * Ensures we never poll sooner than the baseline or before cache expiry.
 */
export function computeNextPollDelayMs(args: {
	basePollIntervalMs: number
	nextPollAt?: string | null
	nowMs?: number
}): number {
	const nowMs = args.nowMs ?? Date.now()
	const cacheReadyAtMs = args.nextPollAt ? new Date(args.nextPollAt).getTime() : nowMs
	const cacheDelayMs = Math.max(0, cacheReadyAtMs - nowMs)
	return Math.max(args.basePollIntervalMs, cacheDelayMs)
}

