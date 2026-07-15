import type { UniversePosition, UniverseStaticMoon } from './geography'

export function selectNearestMoonByPosition(
	moons: UniverseStaticMoon[],
	position: UniversePosition
): UniverseStaticMoon | null {
	let nearestMoon: UniverseStaticMoon | null = null
	let nearestDistance = Number.POSITIVE_INFINITY

	for (const moon of moons) {
		if (
			moon.positionX === null ||
			moon.positionY === null ||
			moon.positionZ === null
		) {
			continue
		}

		const deltaX = moon.positionX - position.x
		const deltaY = moon.positionY - position.y
		const deltaZ = moon.positionZ - position.z
		const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ

		if (distanceSquared < nearestDistance) {
			nearestDistance = distanceSquared
			nearestMoon = moon
		}
	}

	return nearestMoon
}
