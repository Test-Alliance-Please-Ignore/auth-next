import { METENOX_MAGMATIC_GAS_BURN_RATE_PER_HOUR } from '@repo/structures'
import { parseDateOrNull } from '@repo/worker-utils'

const HOUR_MS = 60 * 60 * 1000

export function estimateMagmaticGasDepletionAt(
	units: number | null | undefined,
	snapshotAt: Date | string | number | null | undefined
): string | null {
	if (units === null || units === undefined || !Number.isFinite(units) || units <= 0) {
		return null
	}

	const observedAt =
		snapshotAt === null || snapshotAt === undefined ? null : parseDateOrNull(snapshotAt)
	if (!observedAt) {
		return null
	}

	return new Date(
		observedAt.getTime() + (units / METENOX_MAGMATIC_GAS_BURN_RATE_PER_HOUR) * HOUR_MS
	).toISOString()
}
