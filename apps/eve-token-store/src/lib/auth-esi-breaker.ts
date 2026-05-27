export function computeCircuitOpenUntil(params: {
	nowMs: number
	retryAfterSeconds?: number
	minOpenMs: number
	maxOpenMs: number
	random?: () => number
}): number {
	const { nowMs, retryAfterSeconds, minOpenMs, maxOpenMs } = params
	const random = params.random ?? Math.random
	const baseMs = Math.max(minOpenMs, Math.min(maxOpenMs, (retryAfterSeconds ?? 5) * 1000))
	const jitterMs = Math.floor(random() * Math.max(1, Math.floor(baseMs * 0.25)))
	return nowMs + baseMs + jitterMs
}
