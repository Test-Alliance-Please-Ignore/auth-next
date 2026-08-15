/**
 * Region metadata from SDE geography import.
 */
export interface UniverseRegion {
	regionId: string
	regionName: string
}

/**
 * Constellation metadata from SDE geography import.
 */
export interface UniverseConstellation {
	constellationId: string
	constellationName: string
	regionId: string
}

/**
 * Solar system metadata from SDE geography import.
 */
export interface UniverseSolarSystem {
	solarSystemId: string
	solarSystemName: string
	regionId: string
	constellationId: string
	securityStatus: string | null
}

/**
 * Solar system metadata with the related constellation and region names.
 */
export interface UniverseSolarSystemGeography extends UniverseSolarSystem {
	constellationName: string
	regionName: string
}

/**
 * 3D position metadata.
 */
export interface UniversePosition {
	x: number
	y: number
	z: number
}

/**
 * Planet metadata from SDE geography import.
 */
export interface UniversePlanet {
	planetId: string
	planetName: string
	solarSystemId: string
	celestialIndex: number
	typeId: string | null
}

/**
 * Flattened moon geography context used by snapshot writers.
 */
export interface UniverseMoonGeography {
	moonId: string
	moonName: string
	planetId: string
	planetName: string
	solarSystemId: string
	solarSystemName: string
}

/**
 * Flattened planet geography context used by snapshot writers.
 */
export interface UniversePlanetGeography {
	planetId: string
	planetName: string
	solarSystemId: string
	solarSystemName: string
}

/**
 * Moon metadata for static geography resolution.
 */
export interface UniverseStaticMoon {
	moonId: string
	moonName: string
	planetId: string
	solarSystemId: string
	positionX: number | null
	positionY: number | null
	positionZ: number | null
}

/**
 * Stargate metadata from SDE geography import.
 */
export interface UniverseStargate {
	stargateId: string
	stargateName: string
	solarSystemId: string
	destinationSolarSystemId: string | null
	destinationStargateId: string | null
	typeId: string | null
}

/**
 * NPC station metadata from SDE geography import.
 */
export interface UniverseNpcStation {
	stationId: string
	stationName: string
	solarSystemId: string
	orbitId: string | null
	ownerId: string | null
	operationId: string | null
	typeId: string | null
	useOperationName: boolean
}
