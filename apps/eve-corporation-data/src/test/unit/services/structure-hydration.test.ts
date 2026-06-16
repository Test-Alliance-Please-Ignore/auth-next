import { describe, expect, it } from 'vitest'

import {
	preserveStructureHydrationFields,
} from '../../../services/structure-hydration'

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
