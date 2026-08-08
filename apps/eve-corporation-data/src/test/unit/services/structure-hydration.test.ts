import { describe, expect, it } from 'vitest'

import {
	hasCompleteStructureStaticHydration,
	preserveStructureHydrationFields,
} from '../../../services/structure-hydration'

describe('hasCompleteStructureStaticHydration', () => {
	it('recognizes a fully hydrated existing structure', () => {
		expect(
			hasCompleteStructureStaticHydration({
				typeName: 'Athanor',
				systemName: 'Torrinos',
				regionId: '10000016',
				regionName: 'Lonetrek',
			})
		).toBe(true)
	})

	it('requires all immutable geography and type fields', () => {
		expect(
			hasCompleteStructureStaticHydration({
				typeName: 'Athanor',
				systemName: 'Torrinos',
				regionId: null,
				regionName: 'Lonetrek',
			})
		).toBe(false)
		expect(hasCompleteStructureStaticHydration(null)).toBe(false)
	})
})

describe('preserveStructureHydrationFields', () => {
	it('keeps previously resolved fields when the latest hydration attempt is partial', () => {
		const existing = {
			name: 'Old Keepstar',
			typeName: 'Keepstar',
			systemName: 'Jita',
			regionName: 'The Forge',
		}

		const resolved = preserveStructureHydrationFields(existing, {
			name: null,
			typeName: null,
			systemName: null,
			regionName: null,
			syncStatus: 'warning',
			syncFailureReason: 'Structure details could not be fully hydrated during sync',
		})

		expect(resolved).toEqual({
			name: 'Old Keepstar',
			typeName: 'Keepstar',
			systemName: 'Jita',
			regionName: 'The Forge',
			syncStatus: 'warning',
			syncFailureReason: 'Structure details could not be fully hydrated during sync',
		})
	})

	it('prefers newly resolved fields when they are available', () => {
		const resolved = preserveStructureHydrationFields(
			{
				name: 'Old Keepstar',
				typeName: 'Keepstar',
				systemName: 'Jita',
				regionName: 'The Forge',
			},
			{
				name: 'New Keepstar',
				typeName: 'Astrahus',
				systemName: 'Perimeter',
				regionName: 'Metropolis',
				syncStatus: 'ok',
				syncFailureReason: null,
			}
		)

		expect(resolved).toEqual({
			name: 'New Keepstar',
			typeName: 'Astrahus',
			systemName: 'Perimeter',
			regionName: 'Metropolis',
			syncStatus: 'ok',
			syncFailureReason: null,
		})
	})
})
