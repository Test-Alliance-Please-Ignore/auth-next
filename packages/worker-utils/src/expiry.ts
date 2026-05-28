export interface ExpirySweepItem {
	id: string
	expiresAt: Date | null
}

export interface ExpirySweepOptions<T extends ExpirySweepItem> {
	items: T[]
	now?: Date
	onHardDelete: (item: T) => Promise<void>
}

export interface ExpirySweepResult {
	scanned: number
	purged: number
	failed: number
}

/**
 * Sweep items by per-item TTL (expiresAt) and execute hard-delete hooks.
 * Items with null expiresAt are treated as indefinite and skipped.
 */
export async function runExpirySweep<T extends ExpirySweepItem>(
	options: ExpirySweepOptions<T>
): Promise<ExpirySweepResult> {
	const now = options.now ?? new Date()
	let purged = 0
	let failed = 0
	let scanned = 0

	for (const item of options.items) {
		scanned += 1
		if (!item.expiresAt || item.expiresAt > now) {
			continue
		}
		try {
			await options.onHardDelete(item)
			purged += 1
		} catch {
			failed += 1
		}
	}

	return { scanned, purged, failed }
}
