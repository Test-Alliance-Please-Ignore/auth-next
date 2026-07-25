import { describe, expect, it } from 'vitest'

import { summarizeSkyhooks } from '../../../services/skyhook-summary'

import type { StructureSkyhookListItem } from '@repo/structures'

function makeSkyhook(overrides: Partial<StructureSkyhookListItem>): StructureSkyhookListItem {
	return {
		structureId: 'skyhook-1',
		corporationId: 'corp-1',
		corporationName: 'Test Corp',
		typeId: '81080',
		typeName: 'Orbital Skyhook',
		systemId: '30000142',
		systemName: 'Jita',
		regionId: '10000002',
		regionName: 'The Forge',
		state: 'active',
		nextStateAt: null,
		lowPower: false,
		hidden: false,
		lowPowerAllowed: false,
		assignedGroupId: null,
		syncStatus: 'ok',
		syncFailureReason: null,
		lastSyncedAt: '2026-07-24T00:00:00.000Z',
		updatedAt: '2026-07-24T00:00:00.000Z',
		canViewDetails: true,
		planetId: '40000001',
		planetName: 'Planet I',
		isActive: true,
		effectiveWorkforce: 0,
		totalReagents: 2,
		totalSecuredStock: 0,
		totalUnsecuredStock: 0,
		totalSecuredVolumeM3: 0,
		totalUnsecuredVolumeM3: 0,
		securedCapacityM3: 70080,
		unsecuredCapacityM3: 70080,
		securedFillPercent: 100,
		unsecuredFillPercent: 0,
		reagents: [],
		reinforcementTimerEnd: null,
		theftVulnerabilityStart: null,
		theftVulnerabilityEnd: null,
		isRaidable: false,
		...overrides,
	}
}

describe('skyhook summary', () => {
	it('normalizes the highest fill metric across the secured and surplus bays', () => {
		const summary = summarizeSkyhooks([makeSkyhook({ securedFillPercent: 100, unsecuredFillPercent: 0 })])

		expect(summary.skyhookHighestFillPercent).toBe(50)
	})
})
