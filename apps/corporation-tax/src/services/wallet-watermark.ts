import type { TaxSyncCheckpoint, TaxWalletSourceWatermark } from '@repo/corporation-tax'

export function isCheckpointCurrent(
	checkpoint: Pick<TaxSyncCheckpoint, 'cursor' | 'lastSeenAt'> | undefined,
	watermark: TaxWalletSourceWatermark
): boolean {
	if (watermark.fetchedCount === 0) {
		return true
	}
	if (!checkpoint) {
		return false
	}

	const cursorCurrent =
		!watermark.maxId ||
		(checkpoint.cursor !== null && compareNumericIds(checkpoint.cursor, watermark.maxId) >= 0)
	const dateCurrent =
		!watermark.maxDate ||
		(checkpoint.lastSeenAt !== null && checkpoint.lastSeenAt >= watermark.maxDate)

	return cursorCurrent && dateCurrent
}

export function compareNumericIds(left: string, right: string): number {
	try {
		const leftBigInt = BigInt(left)
		const rightBigInt = BigInt(right)
		if (leftBigInt === rightBigInt) {
			return 0
		}
		return leftBigInt > rightBigInt ? 1 : -1
	} catch {
		return left.localeCompare(right, 'en')
	}
}
