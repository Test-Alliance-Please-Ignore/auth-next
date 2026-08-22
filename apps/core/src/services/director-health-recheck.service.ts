import { withRpcResult } from '@repo/do-utils'

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

export interface DirectorHealthRecheckCorporationDeps {
	characterId: string
	corporationId: string
	getCorporationStub: (corporationId: string) => DirectorHealthRecheckStub
	updateManagedCorporationHealth: (params: {
		corporationId: string
		healthyDirectorCount: number
	}) => Promise<void>
}

export interface DirectorHealthRecheckCorporationResult {
	matched: boolean
	verified: boolean
	healthyDirectorCount?: number
}

export async function recheckDirectorHealthForCorporation(
	deps: DirectorHealthRecheckCorporationDeps
): Promise<DirectorHealthRecheckCorporationResult> {
	const corpStub = deps.getCorporationStub(deps.corporationId)
	const directors = await withRpcResult(corpStub.getDirectors(deps.corporationId), (result) => [
		...result,
	])
	const director = directors.find((entry) => entry.characterId === deps.characterId)
	if (!director) {
		return { matched: false, verified: false }
	}

	const verified = await corpStub.verifyDirectorHealth(deps.corporationId, director.directorId)
	if (!verified) {
		return { matched: true, verified: false }
	}

	const refreshedDirectors = await withRpcResult(
		corpStub.getDirectors(deps.corporationId),
		(result) => [...result]
	)
	const healthyDirectorCount = refreshedDirectors.filter((entry) => entry.isHealthy).length
	await deps.updateManagedCorporationHealth({
		corporationId: deps.corporationId,
		healthyDirectorCount,
	})

	return { matched: true, verified: true, healthyDirectorCount }
}

export async function recheckDirectorHealthAfterTokenReauth(
	deps: DirectorHealthRecheckDeps
): Promise<DirectorHealthRecheckResult> {
	const matchedCorporations: string[] = []
	const verifiedCorporations: string[] = []

	for (const corporation of deps.corporations) {
		const result = await recheckDirectorHealthForCorporation({
			characterId: deps.characterId,
			corporationId: corporation.corporationId,
			getCorporationStub: deps.getCorporationStub,
			updateManagedCorporationHealth: deps.updateManagedCorporationHealth,
		})
		if (result.matched) matchedCorporations.push(corporation.corporationId)
		if (result.verified) verifiedCorporations.push(corporation.corporationId)
	}

	return {
		matchedCorporations,
		verifiedCorporations,
	}
}
