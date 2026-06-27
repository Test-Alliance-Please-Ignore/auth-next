import type { EveCorporationData } from '@repo/eve-corporation-data'

export type ManagedCorporationSummary = {
	corporationId: string
	name: string
}

export type DirectorHealthRecheckDirector = {
	directorId: string
	characterId: string
	characterName: string
}

export type DirectorHealthRecheckStub = Pick<
	EveCorporationData,
	'getDirectors' | 'verifyDirectorHealth'
>

export interface DirectorHealthRecheckDeps {
	characterId: string
	characterName: string
	corporations: ManagedCorporationSummary[]
	getCorporationStub: (corporationId: string) => DirectorHealthRecheckStub
	updateManagedCorporationHealth: (params: {
		corporationId: string
		healthyDirectorCount: number
	}) => Promise<void>
}

export interface DirectorHealthRecheckResult {
	matchedCorporations: string[]
	verifiedCorporations: string[]
}

export async function recheckDirectorHealthAfterTokenReauth(
	deps: DirectorHealthRecheckDeps
): Promise<DirectorHealthRecheckResult> {
	const matchedCorporations: string[] = []
	const verifiedCorporations: string[] = []

	for (const corporation of deps.corporations) {
		const corpStub = deps.getCorporationStub(corporation.corporationId)
		const directors = await corpStub.getDirectors(corporation.corporationId)
		const director = directors.find((entry) => entry.characterId === deps.characterId)
		if (!director) {
			continue
		}

		matchedCorporations.push(corporation.corporationId)

		const verified = await corpStub.verifyDirectorHealth(
			corporation.corporationId,
			director.directorId
		)
		if (!verified) {
			continue
		}

		const refreshedDirectors = await corpStub.getDirectors(corporation.corporationId)
		const healthyDirectorCount = refreshedDirectors.filter((entry) => entry.isHealthy).length
		await deps.updateManagedCorporationHealth({
			corporationId: corporation.corporationId,
			healthyDirectorCount,
		})
		verifiedCorporations.push(corporation.corporationId)
	}

	return {
		matchedCorporations,
		verifiedCorporations,
	}
}
