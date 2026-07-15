import { describe, expect, it } from 'vitest'

import { selectNearestMoonByPosition } from '@repo/universe'

describe('selectNearestMoonByPosition', () => {
	it('returns the nearest moon with coordinates', () => {
		const result = selectNearestMoonByPosition(
			[
				{
					moonId: 'moon-a',
					moonName: 'Moon A',
					planetId: 'planet-1',
					solarSystemId: 'system-1',
					positionX: 0,
					positionY: 0,
					positionZ: 0,
				},
				{
					moonId: 'moon-b',
					moonName: 'Moon B',
					planetId: 'planet-2',
					solarSystemId: 'system-1',
					positionX: 100,
					positionY: 0,
					positionZ: 0,
				},
			],
			{ x: 90, y: 0, z: 0 }
		)

		expect(result?.moonId).toBe('moon-b')
		expect(result?.planetId).toBe('planet-2')
	})

	it('returns null when no moon has usable coordinates', () => {
		const result = selectNearestMoonByPosition(
			[
				{
					moonId: 'moon-a',
					moonName: 'Moon A',
					planetId: 'planet-1',
					solarSystemId: 'system-1',
					positionX: null,
					positionY: null,
					positionZ: null,
				},
			],
			{ x: 90, y: 0, z: 0 }
		)

		expect(result).toBeNull()
	})
})
