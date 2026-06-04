const WALLET_DIVISION_JITTER_WINDOW_MS = 10_000

export function getWalletDivisionJitterMs(index: number, total: number): number {
	if (total <= 1) {
		return 0
	}

	const clampedIndex = Math.max(0, Math.min(index, total - 1))
	return Math.round((clampedIndex / (total - 1)) * WALLET_DIVISION_JITTER_WINDOW_MS)
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
