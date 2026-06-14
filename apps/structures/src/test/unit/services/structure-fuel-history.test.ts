import { describe, expect, it } from 'vitest'

import {
	aggregateFuelBurnRatePerHour,
	deriveStructureFuelHistoryMetrics,
	type StructureFuelHistorySample,
} from '../../../services/structure-fuel-history'

function sample(
	structureId: string,
	fuelBlockUnits: number,
	observedAt: string,
	updatedAt: string = observedAt
): StructureFuelHistorySample {
	return {
		structureId,
		fuelBlockUnits,
		observedAt: new Date(observedAt),
		updatedAt: new Date(updatedAt),
	}
}

describe('structure fuel history metrics', () => {
	it('derives burn rate from the latest decreasing pair', () => {
		const metrics = deriveStructureFuelHistoryMetrics([
			sample('1001', 180, '2026-01-01T00:00:00Z'),
			sample('1001', 132, '2026-01-02T00:00:00Z'),
			sample('1001', 84, '2026-01-03T00:00:00Z'),
		])

		expect(metrics.fuelBurnRatePerHour).toBeCloseTo(2, 6)
		expect(metrics.lastRefilledAt).toBeNull()
		expect(metrics.sampleCount).toBe(3)
	})

	it('tracks the most recent refill and preserves the previous burn rate after a refill', () => {
		const metrics = deriveStructureFuelHistoryMetrics([
			sample('1002', 240, '2026-01-01T00:00:00Z'),
			sample('1002', 180, '2026-01-02T00:00:00Z'),
			sample('1002', 260, '2026-01-03T00:00:00Z'),
		])

		expect(metrics.fuelBurnRatePerHour).toBeCloseTo(2.5, 6)
		expect(metrics.lastRefilledAt?.toISOString()).toBe('2026-01-03T00:00:00.000Z')
		expect(metrics.sampleCount).toBe(3)
	})

	it('returns a refill timestamp without a burn rate when fuel only increased', () => {
		const metrics = deriveStructureFuelHistoryMetrics([
			sample('1003', 120, '2026-01-01T00:00:00Z'),
			sample('1003', 220, '2026-01-02T00:00:00Z'),
		])

		expect(metrics.fuelBurnRatePerHour).toBeNull()
		expect(metrics.lastRefilledAt?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
		expect(metrics.sampleCount).toBe(2)
	})

	it('aggregates burn rates across structures while ignoring structures without a usable rate', () => {
		const aggregate = aggregateFuelBurnRatePerHour(
			new Map<string, StructureFuelHistorySample[]>([
				[
					'1001',
					[
						sample('1001', 180, '2026-01-01T00:00:00Z'),
						sample('1001', 132, '2026-01-02T00:00:00Z'),
						sample('1001', 84, '2026-01-03T00:00:00Z'),
					],
				],
				[
					'1002',
					[
						sample('1002', 120, '2026-01-01T00:00:00Z'),
						sample('1002', 220, '2026-01-02T00:00:00Z'),
					],
				],
				[
					'1003',
					[
						sample('1003', 50, '2026-01-01T00:00:00Z'),
						sample('1003', 50, '2026-01-02T00:00:00Z'),
					],
				],
			])
		)

		expect(aggregate.estimatedFuelBurnRatePerHour).toBe('2.0000')
		expect(aggregate.fuelBurnRateSampleCount).toBe(1)
	})
})
