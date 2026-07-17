import { eq } from 'drizzle-orm'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import { isOpenApplicationStatus } from '@repo/hr'

import { userCharacters, users } from '../db/schema'
import { hasHrAuditorPermission } from './hr-access'

import type { Context } from 'hono'
import type { Core as CoreRpc } from '@repo/core'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Hr } from '@repo/hr'
import type { App, SessionUser } from '../context'

type Db = NonNullable<Context<App>['var']['db']>

type SharedCorporationCandidate = {
	corporationId: string
	source: 'shared-corp' | 'open-application'
}

export type CharacterAccessContext = {
	db: Db
	user: SessionUser
	targetOwner: {
		userId: string
		characterName: string
		immunitas: boolean
	} | null
	isActualOwner: boolean
	isAdmin: boolean
	isHrAuditor: boolean
	isCeoOrDirector: boolean
	viewerRole: 'CEO' | 'Director' | null
	hasHrViewerAccess: boolean
	actualOwner: {
		userId: string
		characterName: string
	} | null
	viewedAsAdmin: boolean
	viewedAsCeoOrDirector: boolean
	viewedAsHrViewer: boolean
}

async function getImmunitasCharacterOwner(db: Db, characterId: string): Promise<{
	userId: string
	characterName: string
	immunitas: boolean
} | null> {
	const owner = await db.query.userCharacters.findFirst({
		where: eq(userCharacters.characterId, characterId),
		columns: {
			userId: true,
			characterName: true,
		},
	})
	if (!owner) {
		return null
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, owner.userId),
		columns: {
			immunitas: true,
		},
	})

	return {
		userId: owner.userId,
		characterName: owner.characterName,
		immunitas: user?.immunitas === true,
	}
}

function canViewCharacterSharedDetails(access: {
	isActualOwner: boolean
	isAdmin: boolean
	isHrAuditor: boolean
	hasHrViewerAccess: boolean
	isCeoOrDirector: boolean
}): boolean {
	return (
		access.isActualOwner ||
		access.isAdmin ||
		access.isHrAuditor ||
		access.hasHrViewerAccess ||
		access.isCeoOrDirector
	)
}

export function canViewCharacterPrivateDetails(access: CharacterAccessContext): boolean {
	return canViewCharacterSharedDetails(access)
}

export function shouldBlockCharacterPrivateAccess(
	access: Pick<CharacterAccessContext, 'isActualOwner' | 'targetOwner'>
): boolean {
	return access.targetOwner?.immunitas === true && !access.isActualOwner
}

async function resolveSharedCorporationCandidates(
	c: Context<App>,
	user: SessionUser,
	targetOwner: NonNullable<CharacterAccessContext['targetOwner']>
): Promise<SharedCorporationCandidate[]> {
	const core = getStub<CoreRpc>(c.env.CORE, 'default')
	const hr = getStub<Hr>(c.env.HR, 'default')
	const [viewerCorporations, targetCorporations, targetApplications] = await Promise.all([
		core.getUserCorporations(user.id),
		core.getUserCorporations(targetOwner.userId),
		hr.listApplications(
			{ userId: targetOwner.userId },
			user.id,
			{
				isAdmin: user.is_admin,
				isAuditor: false,
			}
		),
	])

	const candidateCorporationIds = new Map<string, SharedCorporationCandidate>()
	for (const corporationId of viewerCorporations
		.map((corporation) => corporation.corporationId)
		.filter((corporationId) =>
			targetCorporations.some((targetCorporation) => targetCorporation.corporationId === corporationId)
		)) {
		candidateCorporationIds.set(corporationId, {
			corporationId,
			source: 'shared-corp',
		})
	}

	for (const application of targetApplications) {
		if (!isOpenApplicationStatus(application.status)) continue
		if (!candidateCorporationIds.has(application.corporationId)) {
			candidateCorporationIds.set(application.corporationId, {
				corporationId: application.corporationId,
				source: 'open-application',
			})
		}
	}

	return [...candidateCorporationIds.values()]
}

export async function resolveCharacterAccessContext(
	c: Context<App>,
	characterIdStr: string
): Promise<CharacterAccessContext | Response> {
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	const targetOwner = await getImmunitasCharacterOwner(db, characterIdStr)
	const isActualOwner = user.characters.some(
		(char) => char.characterId.toString() === characterIdStr
	)
	const isAdmin = user.is_admin
	const isHrAuditor = await hasHrAuditorPermission({
		env: c.env,
		userId: user.id,
	})

	let isCeoOrDirector = false
	let viewerRole: 'CEO' | 'Director' | null = null
	let hasHrViewerAccess = false

	if (!isActualOwner && !isAdmin && !isHrAuditor) {
		const hr = getStub<Hr>(c.env.HR, 'default')

		try {
			const candidateCorporations =
				targetOwner ? await resolveSharedCorporationCandidates(c, user, targetOwner) : []

			if (candidateCorporations.length > 0) {
				const viewerCharacterResults = await Promise.all(
					user.characters.map(async (userChar) => {
						try {
							const userCharStub = getStub<EveCharacterData>(
								c.env.EVE_CHARACTER_DATA,
								userChar.characterId
							)
							const userCharInstance = await userCharStub.getInstance(userChar.characterId)
							const userCharInfo = await userCharInstance.getCharacterInfo()
							return {
								characterId: userChar.characterId,
								corporationId: userCharInfo?.corporationId ? String(userCharInfo.corporationId) : null,
							}
						} catch (error) {
							logger.warn('[Character Detail] Error checking viewer character access:', {
								characterId: characterIdStr,
								viewerCharacterId: userChar.characterId,
								error: error instanceof Error ? error.message : String(error),
							})
							return null
						}
					})
				)

				const viewerCharacterInfoByCorp = new Map(
					viewerCharacterResults
						.filter(
							(
								value,
							): value is {
								characterId: string
								corporationId: string | null
							} => Boolean(value?.corporationId)
						)
						.map((value) => [value.corporationId!, value.characterId])
				)

				for (const candidate of candidateCorporations) {
					try {
						if (await hr.checkPermission(user.id, candidate.corporationId, 'hr_viewer')) {
							hasHrViewerAccess = true
							logger.info('[Character Detail] HR access granted', {
								characterId: characterIdStr,
								userId: user.id,
								corporationId: candidate.corporationId,
								source: candidate.source,
							})
							break
						}

						const viewerCharacterId = viewerCharacterInfoByCorp.get(candidate.corporationId)
						if (!viewerCharacterId) continue

						const corpStub = getStub<EveCorporationData>(
							c.env.EVE_CORPORATION_DATA,
							candidate.corporationId
						)
						const [corpInfo, directors] = await Promise.all([
							corpStub.getCorporationInfo(candidate.corporationId),
							corpStub.getDirectors(candidate.corporationId),
						])

						if (corpInfo && String(corpInfo.ceoId) === viewerCharacterId) {
							isCeoOrDirector = true
							viewerRole = 'CEO'
							logger.info('[Character Detail] CEO access granted', {
								characterId: characterIdStr,
								viewerCharacterId,
								corporationId: candidate.corporationId,
								source: candidate.source,
							})
							break
						}

						const isDirector = directors.some(
							(d: { characterId: string }) => d.characterId === viewerCharacterId
						)
						if (isDirector) {
							isCeoOrDirector = true
							viewerRole = 'Director'
							logger.info('[Character Detail] Director access granted', {
								characterId: characterIdStr,
								viewerCharacterId,
								corporationId: candidate.corporationId,
								source: candidate.source,
							})
							break
						}
					} catch (error) {
						logger.warn('[Character Detail] Error checking corporation access:', {
							characterId: characterIdStr,
							corporationId: candidate.corporationId,
							source: candidate.source,
							error: error instanceof Error ? error.message : String(error),
						})
					}
				}
			}
		} catch (error) {
			logger.warn('[Character Detail] Error resolving shared corporation access:', {
				characterId: characterIdStr,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const hasSharedCharacterAccess = canViewCharacterSharedDetails({
		isActualOwner,
		isAdmin,
		isHrAuditor,
		hasHrViewerAccess,
		isCeoOrDirector,
	})

	if (!hasSharedCharacterAccess) {
		return c.json({ error: 'You do not have permission to view this character' }, 403)
	}

	let actualOwner: { userId: string; characterName: string } | null = null
	const viewedAsAdmin = isAdmin && !isActualOwner
	const viewedAsCeoOrDirector = isCeoOrDirector && !isActualOwner
	const viewedAsHrViewer =
		hasHrViewerAccess && !isActualOwner && !isAdmin && !isHrAuditor && !isCeoOrDirector

	if (viewedAsAdmin) {
		try {
			const ownerRecord = await db
				.select({
					userId: userCharacters.userId,
					characterName: userCharacters.characterName,
				})
				.from(userCharacters)
				.where(eq(userCharacters.characterId, characterIdStr))
				.limit(1)

			if (ownerRecord.length > 0) {
				actualOwner = ownerRecord[0]
			}
		} catch (error) {
			logger.error('Error fetching character owner:', error)
		}
	}

	return {
		db,
		user,
		targetOwner,
		isActualOwner,
		isAdmin,
		isHrAuditor,
		isCeoOrDirector,
		viewerRole,
		hasHrViewerAccess,
		actualOwner,
		viewedAsAdmin,
		viewedAsCeoOrDirector,
		viewedAsHrViewer,
	}
}
