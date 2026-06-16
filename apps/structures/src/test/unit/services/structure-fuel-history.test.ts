import { describe, expect, it } from 'vitest'

import {
	aggregateFuelBurnRatePerHour,
	buildStructureFuelUsageHistory,
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

	it('builds an hourly fuel usage history over a fixed window', () => {
		const history = buildStructureFuelUsageHistory(
			[
				sample('1004', 240, '2026-01-03T06:30:00Z'),
				sample('1004', 220, '2026-01-03T08:15:00Z'),
				sample('1004', 200, '2026-01-03T09:40:00Z'),
			],
			{
				now: new Date('2026-01-03T10:45:00Z'),
				windowHours: 4,
			}
		)

		expect(history.points).toHaveLength(4)
		expect(history.points.map((point) => point.observedAt.toISOString())).toEqual([
			'2026-01-03T07:00:00.000Z',
			'2026-01-03T08:00:00.000Z',
			'2026-01-03T09:00:00.000Z',
			'2026-01-03T10:00:00.000Z',
		])
		expect(history.points.map((point) => point.fuelBlockUnits)).toEqual([240, 240, 220, 200])
		expect(history.points[0]?.fuelBurnRatePerHour).toBeNull()
		expect(history.points[1]?.fuelBurnRatePerHour).toBeNull()
		expect(history.points[2]?.fuelBurnRatePerHour).toBeCloseTo(11.428571, 6)
		expect(history.points[3]?.fuelBurnRatePerHour).toBeCloseTo(14.117647, 6)
		expect(history.fuelBurnRatePerHour).toBeCloseTo(14.117647, 6)
		expect(history.lastRefilledAt).toBeNull()
		expect(history.sampleCount).toBe(2)
	})
})
