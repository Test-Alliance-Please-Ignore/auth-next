/**
 * Region metadata from SDE geography import.
 */
export interface UniverseRegion {
	regionId: string
	regionName: string
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
 * Moon metadata for static geography resolution.
 */
export interface UniverseStaticMoon {
	moonId: string
	moonName: string
	planetId: string
	solarSystemId: string
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
