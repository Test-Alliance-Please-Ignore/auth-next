import { logger } from '@repo/hono-helpers'

/**
 * ESI Character information response
 * From: GET /characters/{character_id}/
 */
export interface ESICharacterInfo {
	alliance_id?: number
	ancestry_id?: number
	birthday: string
	bloodline_id: number
	corporation_id: number
	description?: string
	gender: 'male' | 'female'
	name: string
	race_id: number
	security_status?: number
	title?: string
}

/**
 * ESI Corporation information response
 * From: GET /corporations/{corporation_id}/
 */
export interface ESICorporationInfo {
	alliance_id?: number
	ceo_id: number
	creator_id: number
	date_founded?: string
	description?: string
	home_station_id?: number
	member_count: number
	name: string
	shares?: number
	tax_rate: number
	ticker: string
	url?: string
	war_eligible?: boolean
}

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
 * ESI Character skills response
 * From: GET /characters/{character_id}/skills/
 */
export interface ESISkill {
	skill_id: number
	skillpoints_in_skill: number
	trained_skill_level: number
	active_skill_level: number
}

export interface ESICharacterSkills {
	skills: ESISkill[]
	total_sp: number
	unallocated_sp?: number
}

/**
 * ESI Character skillqueue response
 * From: GET /characters/{character_id}/skillqueue/
 */
export interface ESISkillQueueItem {
	skill_id: number
	finished_level: number
	queue_position: number
	start_date?: string
	finish_date?: string
	training_start_sp?: number
	level_start_sp?: number
	level_end_sp?: number
}

export type ESICharacterSkillQueue = ESISkillQueueItem[]

/**
 * ESI Corporation history entry
 * From: GET /characters/{character_id}/corporationhistory/
 */
export interface ESICorporationHistoryEntry {
	corporation_id: number
	is_deleted?: boolean
	record_id: number
	start_date: string
}

export type ESICorporationHistory = ESICorporationHistoryEntry[]

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
