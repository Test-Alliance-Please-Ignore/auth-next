/**
 * Coalesce concurrent work for the same key while allowing unrelated keys to
 * proceed independently. The entry is removed after success or failure.
 */
export function runSingleFlight<K, V>(
	inFlight: Map<K, Promise<V>>,
	key: K,
	operation: () => Promise<V>
): Promise<V> {
	const existing = inFlight.get(key)
	if (existing) return existing

	const pending = operation()
	inFlight.set(key, pending)
	pending
		.finally(() => {
			if (inFlight.get(key) === pending) {
				inFlight.delete(key)
			}
		})
		.catch(() => {
			// The original promise remains the source of the operation's error. This
			// handler prevents the cleanup promise from becoming an unhandled rejection.
		})
	return pending
}
