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
