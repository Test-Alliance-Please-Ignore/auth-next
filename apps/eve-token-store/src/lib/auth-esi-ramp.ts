export function computeRampRetryAfterSeconds(
	remainingRampMs: number,
	random: () => number = Math.random
): number {
	const baseRetryAfterSeconds = Math.max(5, Math.min(60, Math.ceil(remainingRampMs / 4000)))
	const jitterSeconds = Math.floor(random() * (baseRetryAfterSeconds + 1))
	return Math.max(5, Math.min(60, jitterSeconds))
}
