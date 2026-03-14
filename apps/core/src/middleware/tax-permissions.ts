import { getStub } from '@repo/do-utils'
import { logger, TimeCache } from '@repo/hono-helpers'

import { getCachedCharacterPermissions, getCachedUserPermissions } from '../lib/groups-cache'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { App, SessionUser } from '../context'

const corpSelfServiceCache = new TimeCache<boolean>(60_000)
const corpMembershipCache = new TimeCache<boolean>(60_000)

export const TAX_VIEWER_URN = 'urn:tax:viewer'
export const TAX_AUDITOR_URN = 'urn:tax:auditor'
export const TAX_ADMIN_URN = 'urn:tax:admin'

const TAX_AUDIT_URNS = [TAX_AUDITOR_URN, TAX_ADMIN_URN] as const
const TAX_MANAGE_URNS = [TAX_ADMIN_URN] as const

export function getTaxCharacterIds(user: SessionUser): string[] {
	return user.characters.map((character) => character.characterId)
}

export async function hasCorporationSelfServiceAccess(
	env: App['Bindings'],
	user: SessionUser,
	corporationId: string
): Promise<boolean> {
	if (user.is_admin) {
		return true
	}

	const cacheKey = `${user.id}:${corporationId}`
	return corpSelfServiceCache.getOrSet(cacheKey, async () => {
		const characterIds = getTaxCharacterIds(user)
		if (characterIds.length === 0) {
			return false
		}

		const corporationStub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
		let corporationInfo: Awaited<ReturnType<EveCorporationData['getCorporationInfo']>>
		let directors: Awaited<ReturnType<EveCorporationData['getDirectors']>>

		try {
			;[corporationInfo, directors] = await Promise.all([
				corporationStub.getCorporationInfo(corporationId),
				corporationStub.getDirectors(corporationId),
			])
		} catch (error) {
			logger.error('[CorporationTax] Failed to resolve corporation self-service authority', {
				userId: user.id,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}

		const directorIds = new Set(directors.map((director) => director.characterId))
		for (const characterId of characterIds) {
			try {
				const characterStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)
				const characterInfo = await characterStub.getCharacterInfo(characterId)
				if (!characterInfo || String(characterInfo.corporationId) !== corporationId) {
					continue
				}

				const isCeo = corporationInfo && String(corporationInfo.ceoId) === characterId
				const isDirector = directorIds.has(characterId)
				if (isCeo || isDirector) {
					return true
				}
			} catch (error) {
				logger.warn('[CorporationTax] Failed character self-service resolution', {
					userId: user.id,
					corporationId,
					characterId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return false
	})
}

export async function hasTaxPermission(
	env: App['Bindings'],
	user: SessionUser,
	requiredUrns: readonly string[],
	corporationId?: string,
	options?: {
		allowCorporationSelfService?: boolean
	}
): Promise<boolean> {
	if (user.is_admin) {
		return true
	}

	const groupPermissions = await getCachedUserPermissions(env, user.id)
	if (groupPermissions.some((permission) => requiredUrns.includes(permission.urn))) {
		return true
	}

	const characterIds = getTaxCharacterIds(user)
	for (const characterId of characterIds) {
		const characterPermissions = await getCachedCharacterPermissions(env, characterId)
		if (characterPermissions.some((permission) => requiredUrns.includes(permission.urn))) {
			return true
		}
	}

	const allowCorporationSelfService = options?.allowCorporationSelfService ?? true
	if (!allowCorporationSelfService || !corporationId) {
		return false
	}

	return hasCorporationSelfServiceAccess(env, user, corporationId)
}

export async function hasCorporationMembershipAccess(
	env: App['Bindings'],
	user: SessionUser,
	corporationId: string
): Promise<boolean> {
	if (user.is_admin) {
		return true
	}

	const cacheKey = `${user.id}:${corporationId}:member`
	return corpMembershipCache.getOrSet(cacheKey, async () => {
		const characterIds = getTaxCharacterIds(user)
		if (characterIds.length === 0) {
			return false
		}

		for (const characterId of characterIds) {
			try {
				const characterStub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, characterId)
				const characterInfo = await characterStub.getCharacterInfo(characterId)
				if (characterInfo && String(characterInfo.corporationId) === corporationId) {
					return true
				}
			} catch (error) {
				logger.warn('[CorporationTax] Failed character membership resolution', {
					userId: user.id,
					corporationId,
					characterId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return false
	})
}

export async function canReadTaxFeature(
	env: App['Bindings'],
	user: SessionUser,
	corporationId?: string
): Promise<boolean> {
	if (user.is_admin) {
		return true
	}

	const normalizedCorporationId = corporationId?.trim() || undefined

	const hasAuditorOrAdminUrn = await hasTaxPermission(
		env,
		user,
		[TAX_AUDITOR_URN, TAX_ADMIN_URN],
		undefined,
		{
			allowCorporationSelfService: false,
		}
	)
	if (hasAuditorOrAdminUrn) {
		return true
	}

	if (!normalizedCorporationId) {
		return false
	}

	const hasViewerUrn = await hasTaxPermission(env, user, [TAX_VIEWER_URN], undefined, {
		allowCorporationSelfService: false,
	})
	if (hasViewerUrn) {
		const hasMembership = await hasCorporationMembershipAccess(env, user, normalizedCorporationId)
		if (hasMembership) {
			return true
		}
	}

	return hasCorporationSelfServiceAccess(env, user, normalizedCorporationId)
}

export async function canAuditTaxFeature(
	env: App['Bindings'],
	user: SessionUser,
	corporationId?: string
): Promise<boolean> {
	void corporationId
	return hasTaxPermission(env, user, TAX_AUDIT_URNS, undefined, {
		allowCorporationSelfService: false,
	})
}

export async function canManageTaxFeature(
	env: App['Bindings'],
	user: SessionUser,
	corporationId?: string
): Promise<boolean> {
	void corporationId
	return hasTaxPermission(env, user, TAX_MANAGE_URNS, undefined, {
		allowCorporationSelfService: false,
	})
}
