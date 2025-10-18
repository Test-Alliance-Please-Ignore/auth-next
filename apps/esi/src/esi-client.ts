import type {
	ESICharacterInfo,
	ESICharacterSkillQueue,
	ESICharacterSkills,
	ESICorporationHistory,
	ESICorporationInfo,
} from '@repo/character-data-store'
import { logger } from '@repo/hono-helpers'

/**
 * ESI Alliance information response
 * From: GET /alliances/{alliance_id}/
 */
export interface ESIAllianceInfo {
	creator_corporation_id: number
	creator_id: number
	date_founded: string
	executor_corporation_id?: number
	faction_id?: number
	name: string
	ticker: string
}

/**
 * Parse cache control header and calculate expiration timestamp
 */
export function parseCacheControl(cacheControlHeader: string | null): number | null {
	if (!cacheControlHeader) {
		return null
	}

	const maxAgeMatch = cacheControlHeader.match(/max-age=(\d+)/)
	if (!maxAgeMatch) {
		return null
	}

	const maxAgeSeconds = parseInt(maxAgeMatch[1], 10)
	const expiresAt = Date.now() + maxAgeSeconds * 1000

	return expiresAt
}

/**
 * Fetch character information from ESI
 */
export async function fetchCharacterInfo(
	characterId: number,
	accessToken: string
): Promise<{ data: ESICharacterInfo; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/characters/${characterId}/`

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_character_fetch_error',
				character_id: characterId,
			})
			.error('Failed to fetch character info from ESI', {
				characterId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch character info: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESICharacterInfo
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_character_fetched',
			character_id: characterId,
		})
		.info('Character info fetched from ESI', {
			characterId,
			characterName: data.name,
			corporationId: data.corporation_id,
			allianceId: data.alliance_id,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch corporation information from ESI
 */
export async function fetchCorporationInfo(
	corporationId: number,
	accessToken?: string
): Promise<{ data: ESICorporationInfo; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/corporations/${corporationId}/`

	const headers: HeadersInit = {
		'X-Compatibility-Date': '2025-09-30',
	}

	// Corporation endpoint is public, but we'll use auth if available
	if (accessToken) {
		headers.Authorization = `Bearer ${accessToken}`
	}

	const response = await fetch(url, { headers })

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_corporation_fetch_error',
				corporation_id: corporationId,
			})
			.error('Failed to fetch corporation info from ESI', {
				corporationId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch corporation info: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESICorporationInfo
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_corporation_fetched',
			corporation_id: corporationId,
		})
		.info('Corporation info fetched from ESI', {
			corporationId,
			corporationName: data.name,
			ticker: data.ticker,
			allianceId: data.alliance_id,
			memberCount: data.member_count,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch alliance information from ESI
 */
export async function fetchAllianceInfo(
	allianceId: number,
	accessToken?: string
): Promise<{ data: ESIAllianceInfo; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/alliances/${allianceId}/`

	const headers: HeadersInit = {
		'X-Compatibility-Date': '2025-09-30',
	}

	// Alliance endpoint is public, but we'll use auth if available
	if (accessToken) {
		headers.Authorization = `Bearer ${accessToken}`
	}

	const response = await fetch(url, { headers })

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_alliance_fetch_error',
				alliance_id: allianceId,
			})
			.error('Failed to fetch alliance info from ESI', {
				allianceId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch alliance info: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESIAllianceInfo
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_alliance_fetched',
			alliance_id: allianceId,
		})
		.info('Alliance info fetched from ESI', {
			allianceId,
			allianceName: data.name,
			ticker: data.ticker,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch character skills from ESI
 */
export async function fetchCharacterSkills(
	characterId: number,
	accessToken: string
): Promise<{ data: ESICharacterSkills; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/v4/characters/${characterId}/skills/`

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_skills_fetch_error',
				character_id: characterId,
			})
			.error('Failed to fetch character skills from ESI', {
				characterId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch character skills: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESICharacterSkills
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_skills_fetched',
			character_id: characterId,
		})
		.info('Character skills fetched from ESI', {
			characterId,
			totalSP: data.total_sp,
			unallocatedSP: data.unallocated_sp,
			skillCount: data.skills.length,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch character skillqueue from ESI
 */
export async function fetchCharacterSkillQueue(
	characterId: number,
	accessToken: string
): Promise<{ data: ESICharacterSkillQueue; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/v2/characters/${characterId}/skillqueue/`

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_skillqueue_fetch_error',
				character_id: characterId,
			})
			.error('Failed to fetch character skillqueue from ESI', {
				characterId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(
			`Failed to fetch character skillqueue: ${response.status} ${response.statusText}`
		)
	}

	const data = (await response.json()) as ESICharacterSkillQueue
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_skillqueue_fetched',
			character_id: characterId,
		})
		.info('Character skillqueue fetched from ESI', {
			characterId,
			queueLength: data.length,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch character corporation history from ESI
 * This is a public endpoint that doesn't require authentication
 */
export async function fetchCharacterCorporationHistory(
	characterId: number
): Promise<{ data: ESICorporationHistory; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/characters/${characterId}/corporationhistory/`

	const response = await fetch(url, {
		headers: {
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_corporation_history_fetch_error',
				character_id: characterId,
			})
			.error('Failed to fetch character corporation history from ESI', {
				characterId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(
			`Failed to fetch corporation history: ${response.status} ${response.statusText}`
		)
	}

	const data = (await response.json()) as ESICorporationHistory
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_corporation_history_fetched',
			character_id: characterId,
		})
		.info('Corporation history fetched from ESI', {
			characterId,
			historyCount: data.length,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch character wallet balance from ESI
 * Requires authentication with scope: esi-wallet.read_character_wallet.v1
 */
export async function fetchCharacterWallet(
	characterId: number,
	accessToken: string
): Promise<{ data: number; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/characters/${characterId}/wallet/`

	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_wallet_fetch_error',
				character_id: characterId,
			})
			.error('Failed to fetch character wallet from ESI', {
				characterId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch wallet: ${response.status} ${response.statusText}`)
	}

	// ESI returns a plain number for wallet balance
	const data = await response.json() as number
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_wallet_fetched',
			character_id: characterId,
		})
		.info('Character wallet fetched from ESI', {
			characterId,
			balance: data,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * ESI Type information response
 * From: GET /universe/types/{type_id}/
 */
export interface ESITypeInfo {
	capacity?: number
	description: string
	dogma_attributes?: Array<{
		attribute_id: number
		value: number
	}>
	dogma_effects?: Array<{
		effect_id: number
		is_default: boolean
	}>
	graphic_id?: number
	group_id: number
	icon_id?: number
	market_group_id?: number
	mass?: number
	name: string
	packaged_volume?: number
	portion_size?: number
	published: boolean
	radius?: number
	type_id: number
	volume?: number
}

/**
 * ESI Group information response
 * From: GET /universe/groups/{group_id}/
 */
export interface ESIGroupInfo {
	category_id: number
	group_id: number
	name: string
	published: boolean
	types: number[]
}

/**
 * ESI Category information response
 * From: GET /universe/categories/{category_id}/
 */
export interface ESICategoryInfo {
	category_id: number
	groups: number[]
	name: string
	published: boolean
}

/**
 * Fetch type information from ESI
 * This is a public endpoint that doesn't require authentication
 */
export async function fetchTypeInfo(
	typeId: number
): Promise<{ data: ESITypeInfo; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/universe/types/${typeId}/`

	const response = await fetch(url, {
		headers: {
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_type_fetch_error',
				type_id: typeId,
			})
			.error('Failed to fetch type info from ESI', {
				typeId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch type info: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESITypeInfo
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_type_fetched',
			type_id: typeId,
		})
		.info('Type info fetched from ESI', {
			typeId,
			typeName: data.name,
			groupId: data.group_id,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch group information from ESI
 * This is a public endpoint that doesn't require authentication
 */
export async function fetchGroupInfo(
	groupId: number
): Promise<{ data: ESIGroupInfo; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/universe/groups/${groupId}/`

	const response = await fetch(url, {
		headers: {
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_group_fetch_error',
				group_id: groupId,
			})
			.error('Failed to fetch group info from ESI', {
				groupId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch group info: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESIGroupInfo
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_group_fetched',
			group_id: groupId,
		})
		.info('Group info fetched from ESI', {
			groupId,
			groupName: data.name,
			categoryId: data.category_id,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}

/**
 * Fetch category information from ESI
 * This is a public endpoint that doesn't require authentication
 */
export async function fetchCategoryInfo(
	categoryId: number
): Promise<{ data: ESICategoryInfo; expiresAt: number | null }> {
	const url = `https://esi.evetech.net/latest/universe/categories/${categoryId}/`

	const response = await fetch(url, {
		headers: {
			'X-Compatibility-Date': '2025-09-30',
		},
	})

	if (!response.ok) {
		logger
			.withTags({
				type: 'esi_category_fetch_error',
				category_id: categoryId,
			})
			.error('Failed to fetch category info from ESI', {
				categoryId,
				status: response.status,
				statusText: response.statusText,
			})
		throw new Error(`Failed to fetch category info: ${response.status} ${response.statusText}`)
	}

	const data = (await response.json()) as ESICategoryInfo
	const cacheControl = response.headers.get('Cache-Control')
	const expiresAt = parseCacheControl(cacheControl)

	logger
		.withTags({
			type: 'esi_category_fetched',
			category_id: categoryId,
		})
		.info('Category info fetched from ESI', {
			categoryId,
			categoryName: data.name,
			groupCount: data.groups.length,
			expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
		})

	return { data, expiresAt }
}
