import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_COMPATIBILITY_DATE = '2026-05-19'
const EVE_OAUTH_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const DIAGNOSTIC_ENV_PREFIX = 'DIAGNOSTIC' as const
const REGION_10000023_ID = '10000023'
const REGION_10000023_NAME = 'Pure Blind'
const REGION_10000023_SYSTEM_IDS = new Set<string>([
	'30001963',
	'30001964',
	'30001965',
	'30001966',
	'30001967',
	'30001968',
	'30001969',
	'30001970',
	'30001971',
	'30001972',
	'30001973',
	'30001974',
	'30001975',
	'30001976',
	'30001977',
	'30001978',
	'30001979',
	'30001980',
	'30001981',
	'30001982',
	'30001983',
	'30001984',
	'30001985',
	'30001986',
	'30001987',
	'30001988',
	'30001989',
	'30001990',
	'30001991',
	'30001992',
	'30001993',
	'30001994',
	'30001995',
	'30001996',
	'30001997',
	'30001998',
	'30001999',
	'30002000',
	'30002001',
	'30002002',
	'30002003',
	'30002004',
	'30002005',
	'30002006',
	'30002007',
	'30002008',
	'30002009',
	'30002010',
	'30002011',
	'30002012',
	'30002013',
	'30002014',
	'30002015',
	'30002016',
	'30002017',
	'30002018',
	'30002019',
	'30002020',
	'30002021',
	'30002022',
	'30002023',
	'30002024',
	'30002025',
	'30002026',
	'30002027',
	'30002028',
	'30002029',
	'30002030',
	'30002031',
	'30002032',
	'30002033',
	'30002034',
	'30002035',
	'30002036',
	'30002037',
	'30002038',
	'30002039',
	'30002040',
	'30002041',
	'30002042',
	'30002043',
	'30002044',
	'30002045',
	'30002046',
	'30002047',
])

type RawSovereigntySystem = {
	solar_systems: Array<{
		solar_system_id: number
		claim?: {
			alliance?: {
				alliance_id: number
				corporation_id: number
				claimed_since: string
				is_capital_system: boolean
				sovereignty_hub: {
					id: number
					vulnerability_window?: {
						start: string
						end: string
					}
				}
				development: {
					activity_defense_multiplier: number
					military_level: number
					industrial_level: number
					strategic_level: number
				}
			}
			faction?: {
				faction_id: number
			}
			unclaimed?: boolean
		}
	}>
}

type SovereigntyHubsListing = {
	sovereignty_hubs: Array<{
		id: number
		solar_system_id: number
	}>
}

type SovereigntyHubDetail = {
	id: number
	solar_system_id: number
	controller_alliance_id?: number | null
	fuel_access_list_id?: number | null
	reagent_bay: {
		last_updated: string
		reagents: Array<{
			type_id: number
			amount: number
			burning_per_hour: number
			last_cycle: string
		}>
	}
	resources: {
		power: {
			allocated: number
			available: number
		}
		workforce: {
			allocated: number
			available: number
		}
	}
	upgrades: Array<{
		type_id: number
		power_state: string
	}>
	vulnerability_window?: {
		start: string
		end: string
	} | null
	workforce_transport: unknown
}

type OAuthMetadata = {
	token_endpoint: string
}

type AllianceDetail = {
	creator_corporation_id: number
	creator_id: number
	date_founded: string
	executor_corporation_id?: number
	faction_id?: number
	name: string
	ticker: string
}

function loadEnvFile(): void {
	const __dirname = dirname(fileURLToPath(import.meta.url))
	const envPath = resolve(__dirname, '../../../../.env')

	try {
		const envContent = readFileSync(envPath, 'utf-8')
		for (const line of envContent.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) continue
			const match = trimmed.match(/^([^=]+)=(.*)$/)
			if (!match) continue

			const key = match[1].trim()
			let value = match[2].trim()
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1)
			} else {
				const commentIndex = value.indexOf(' #')
				if (commentIndex !== -1) {
					value = value.slice(0, commentIndex).trimEnd()
				}
			}
			process.env[key] = value
		}
	} catch {
		// Optional local env file.
	}
}

function parseArgs() {
	const args = process.argv.slice(2)
	let corporationId: string | undefined
	let accessToken: string | undefined
	let refreshToken: string | undefined
	let clientId: string | undefined
	let clientSecret: string | undefined
	let baseUrl = 'https://esi.evetech.net'
	let compatibilityDate = DEFAULT_COMPATIBILITY_DATE

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i]

		if (arg === '--corp' || arg === '--corporation-id') {
			corporationId = args[++i]
		} else if (arg === '--access-token' || arg === '--token') {
			accessToken = args[++i]
		} else if (arg === '--refresh-token') {
			refreshToken = args[++i]
		} else if (arg === '--client-id') {
			clientId = args[++i]
		} else if (arg === '--client-secret') {
			clientSecret = args[++i]
		} else if (arg === '--base-url') {
			baseUrl = args[++i] ?? baseUrl
		} else if (arg === '--compatibility-date') {
			compatibilityDate = args[++i] ?? compatibilityDate
		} else if (arg === '--help' || arg === '-h') {
			console.log('Usage: pnpm -F eve-corporation-data diagnose-sovereignty --corp <corporationId> [options]')
			console.log('')
			console.log('Options:')
			console.log('  --corp, --corporation-id <id>   Corporation ID to inspect')
			console.log('  --access-token <jwt>            Optional pre-minted access token override')
			console.log('  --refresh-token <jwt>           Refresh token used to mint an access token')
			console.log('  --client-id <id>                OAuth client ID for the refresh flow')
			console.log('  --client-secret <secret>        OAuth client secret for the refresh flow')
			console.log('  --base-url <url>                ESI base URL (default: https://esi.evetech.net)')
			console.log('  --compatibility-date <YYYY-MM-DD>  Override ESI compatibility date')
			console.log('')
			console.log('Env defaults:')
			console.log('  DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN')
			console.log('  DIAGNOSTIC_EVE_SSO_CLIENT_ID')
			console.log('  DIAGNOSTIC_EVE_SSO_CLIENT_SECRET')
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	if (!corporationId) {
		throw new Error('Missing required --corp/--corporation-id value')
	}

	return {
		corporationId,
		accessToken,
		refreshToken,
		clientId,
		clientSecret,
		baseUrl,
		compatibilityDate,
	}
}

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '')
}

function getEnvValue(...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = process.env[key]?.trim()
		if (value) {
			return value
		}
	}
	return undefined
}

async function fetchJson<T>(
	url: string,
	init: RequestInit,
	label: string
): Promise<{ data: T; headers: Headers; status: number }> {
	const response = await fetch(url, init)
	if (!response.ok) {
		const body = await response.text()
		throw new Error(`${label} failed: ${response.status} ${response.statusText} - ${body}`)
	}

	return {
		data: (await response.json()) as T,
		headers: response.headers,
		status: response.status,
	}
}

async function fetchOAuthMetadata() {
	return await fetchJson<OAuthMetadata>(
		EVE_OAUTH_METADATA_URL,
		{
			headers: {
				'User-Agent': 'eve-corporation-data-diagnostics/1.0',
				accept: 'application/json',
			},
		},
		'GET /.well-known/oauth-authorization-server'
	)
}

async function fetchSovereigntySystems(baseUrl: string, compatibilityDate: string) {
	return await fetchJson<RawSovereigntySystem>(
		`${baseUrl}/sovereignty/systems`,
		{
			headers: {
				'User-Agent': 'eve-corporation-data-diagnostics/1.0',
				'X-Compatibility-Date': compatibilityDate,
			},
		},
		'GET /sovereignty/systems'
	)
}

async function refreshAccessToken(input: {
	clientId: string
	clientSecret: string
	refreshToken: string
	tokenEndpoint: string
}): Promise<string> {
	const credentials = btoa(`${input.clientId}:${input.clientSecret}`)
	const response = await fetch(input.tokenEndpoint, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			Host: 'login.eveonline.com',
			'User-Agent': 'eve-corporation-data-diagnostics/1.0',
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: input.refreshToken,
		}),
	})

	if (!response.ok) {
		const body = await response.text()
		throw new Error(`Refresh token exchange failed: ${response.status} ${response.statusText} - ${body}`)
	}

	const tokenResponse = (await response.json()) as { access_token: string }
	if (!tokenResponse.access_token) {
		throw new Error('Refresh token exchange did not return an access token')
	}

	return tokenResponse.access_token
}

async function fetchSovereigntyHubs(
	corporationId: string,
	accessToken: string,
	baseUrl: string,
	compatibilityDate: string
) {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': 'eve-corporation-data-diagnostics/1.0',
		'X-Compatibility-Date': compatibilityDate,
	}

	const firstPage = await fetchJson<SovereigntyHubsListing>(
		`${baseUrl}/corporations/${corporationId}/structures/sovereignty-hubs?page=1`,
		{ headers },
		'GET /corporations/{corporation_id}/structures/sovereignty-hubs?page=1'
	)

	const hubs = [...firstPage.data.sovereignty_hubs]
	const totalPages = Number(firstPage.headers.get('X-Pages') ?? '1')

	for (let page = 2; page <= totalPages; page += 1) {
		const pageResult = await fetchJson<SovereigntyHubsListing>(
			`${baseUrl}/corporations/${corporationId}/structures/sovereignty-hubs?page=${page}`,
			{ headers },
			`GET /corporations/{corporation_id}/structures/sovereignty-hubs?page=${page}`
		)
		hubs.push(...pageResult.data.sovereignty_hubs)
	}

	return {
		pages: totalPages,
		listing: hubs,
	}
}

async function fetchSovereigntyHubDetails(
	corporationId: string,
	accessToken: string,
	baseUrl: string,
	compatibilityDate: string,
	sovereigntyHubIds: number[]
) {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': 'eve-corporation-data-diagnostics/1.0',
		'X-Compatibility-Date': compatibilityDate,
	}

	const details = await Promise.all(
		sovereigntyHubIds.map(async (hubId) => {
			const result = await fetchJson<SovereigntyHubDetail>(
				`${baseUrl}/corporations/${corporationId}/structures/sovereignty-hubs/${hubId}`,
				{ headers },
				`GET /corporations/{corporation_id}/structures/sovereignty-hubs/${hubId}`
			)
			return result.data
		})
	)

	return details
}

async function fetchAllianceDetails(
	baseUrl: string,
	compatibilityDate: string,
	allianceIds: number[]
) {
	const headers = {
		'User-Agent': 'eve-corporation-data-diagnostics/1.0',
		'X-Compatibility-Date': compatibilityDate,
	}
	const entries = await Promise.all(
		allianceIds.map(async (allianceId) => {
			try {
				const result = await fetchJson<AllianceDetail>(
					`${baseUrl}/alliances/${allianceId}`,
					{ headers },
					`GET /alliances/${allianceId}`
				)
				return [String(allianceId), result.data] as const
			} catch (error) {
				console.warn(
					`Failed to resolve alliance ${allianceId}: ${error instanceof Error ? error.message : String(error)}`
				)
				return [String(allianceId), null] as const
			}
		})
	)

	return new Map(entries)
}

async function main(): Promise<void> {
	loadEnvFile()
	const {
		corporationId,
		accessToken,
		refreshToken,
		clientId,
		clientSecret,
		baseUrl,
		compatibilityDate,
	} = parseArgs()
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
	const regionSystemIds = REGION_10000023_SYSTEM_IDS

	let bearerToken =
		accessToken ?? getEnvValue(`${DIAGNOSTIC_ENV_PREFIX}_EVE_SSO_ACCESS_TOKEN`)
	if (!bearerToken) {
		const oauthMetadata = await fetchOAuthMetadata()
		const resolvedRefreshToken = refreshToken ?? getEnvValue(
			`${DIAGNOSTIC_ENV_PREFIX}_EVE_SSO_REFRESH_TOKEN`
		)
		const resolvedClientId = clientId ?? getEnvValue(
			`${DIAGNOSTIC_ENV_PREFIX}_EVE_SSO_CLIENT_ID`
		)
		const resolvedClientSecret = clientSecret ?? getEnvValue(
			`${DIAGNOSTIC_ENV_PREFIX}_EVE_SSO_CLIENT_SECRET`
		)

		if (!resolvedRefreshToken) {
			throw new Error(
				'Missing access token and refresh token. Set DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN (preferred) or pass --access-token.'
			)
		}
		if (!resolvedClientId) {
			throw new Error(
				'Missing OAuth client ID. Set DIAGNOSTIC_EVE_SSO_CLIENT_ID (preferred) or pass --client-id.'
			)
		}
		if (!resolvedClientSecret) {
			throw new Error(
				'Missing OAuth client secret. Set DIAGNOSTIC_EVE_SSO_CLIENT_SECRET (preferred) or pass --client-secret.'
			)
		}

		bearerToken = await refreshAccessToken({
			clientId: resolvedClientId,
			clientSecret: resolvedClientSecret,
			refreshToken: resolvedRefreshToken,
			tokenEndpoint: oauthMetadata.data.token_endpoint,
		})
	}

	const systemsResult = await fetchSovereigntySystems(normalizedBaseUrl, compatibilityDate)
	const regionSystems = systemsResult.data.solar_systems.filter((system) =>
		regionSystemIds.has(String(system.solar_system_id))
	)
	const systemById = new Map(regionSystems.map((system) => [String(system.solar_system_id), system] as const))

	let hubsListing: Awaited<ReturnType<typeof fetchSovereigntyHubs>> | null = null
	let hubDetails: SovereigntyHubDetail[] = []
	let regionHubListing: SovereigntyHubsListing['sovereignty_hubs'] = []

	if (bearerToken) {
		hubsListing = await fetchSovereigntyHubs(
			corporationId,
			bearerToken,
			normalizedBaseUrl,
			compatibilityDate
		)
		const regionHubIds = hubsListing.listing
			.filter((hub) => regionSystemIds.has(String(hub.solar_system_id)))
			.map((hub) => hub.id)
		regionHubListing = hubsListing.listing.filter((hub) =>
			regionSystemIds.has(String(hub.solar_system_id))
		)
		hubDetails = await fetchSovereigntyHubDetails(
			corporationId,
			bearerToken,
			normalizedBaseUrl,
			compatibilityDate,
			regionHubIds
		)
	}

	const hubDetailsBySystemId = new Map(
		hubDetails.map((detail) => [String(detail.solar_system_id), detail] as const)
	)

	const allianceIds = new Set<number>()
	for (const system of regionSystems) {
		const allianceId = system.claim?.alliance?.alliance_id
		if (typeof allianceId === 'number') {
			allianceIds.add(allianceId)
		}
	}
	for (const hub of hubDetails) {
		if (typeof hub.controller_alliance_id === 'number') {
			allianceIds.add(hub.controller_alliance_id)
		}
	}

	const allianceDetailsById = allianceIds.size > 0
		? await fetchAllianceDetails(normalizedBaseUrl, compatibilityDate, [...allianceIds])
		: new Map<string, AllianceDetail | null>()

	const sovereigntySystemSummary = regionSystems.map((system) => {
		const claim = system.claim
		if (claim?.alliance) {
			const allianceId = String(claim.alliance.alliance_id)
			const alliance = allianceDetailsById.get(allianceId) ?? null
			return {
				systemId: String(system.solar_system_id),
				claimType: 'alliance',
				allianceId,
				allianceName: alliance?.name ?? null,
				allianceTicker: alliance?.ticker ?? null,
				corporationId: String(claim.alliance.corporation_id),
				sovereigntyHubId: String(claim.alliance.sovereignty_hub.id),
			}
		}

		if (claim?.faction) {
			return {
				systemId: String(system.solar_system_id),
				claimType: 'faction',
				factionId: String(claim.faction.faction_id),
			}
		}

			return {
				systemId: String(system.solar_system_id),
				claimType: 'unclaimed',
			}
	})

	const hubComparison = regionHubListing.map((hub) => {
			const detail = hubDetailsBySystemId.get(String(hub.solar_system_id))
			const system = systemById.get(String(hub.solar_system_id))
			const alliance = system?.claim?.alliance ?? null
			const allianceId = alliance ? alliance.alliance_id : null
			const systemAlliance = allianceId !== null ? allianceDetailsById.get(String(allianceId)) ?? null : null
			const controllerAllianceId = detail?.controller_alliance_id ?? null
			const controllerAlliance =
				controllerAllianceId !== null
					? allianceDetailsById.get(String(controllerAllianceId)) ?? null
					: null

			return {
				structureId: String(hub.id),
				systemId: String(hub.solar_system_id),
				esiControllerAllianceId: detail?.controller_alliance_id ?? null,
				esiControllerAllianceName: controllerAlliance?.name ?? null,
				esiControllerAllianceTicker: controllerAlliance?.ticker ?? null,
				esiAllianceIdFromSystems: allianceId !== null ? String(allianceId) : null,
				esiAllianceNameFromSystems: systemAlliance?.name ?? null,
				esiAllianceTickerFromSystems: systemAlliance?.ticker ?? null,
				systemClaimType: system?.claim
					? 'alliance' in system.claim
						? 'alliance'
						: 'faction' in system.claim
							? 'faction'
							: 'unclaimed'
					: 'unknown',
			}
		})

	const mismatches = hubComparison.filter(
		(entry) => entry.esiControllerAllianceId !== entry.esiAllianceIdFromSystems
	)

	const output = {
		fetchedAt: new Date().toISOString(),
		corporationId,
		regionFilter: {
			regionId: REGION_10000023_ID,
			regionName: REGION_10000023_NAME,
			systemCount: regionSystemIds.size,
		},
		compatibilityDate,
		baseUrl: normalizedBaseUrl,
		systems: {
			count: regionSystems.length,
			headers: {
				etag: systemsResult.headers.get('ETag'),
				expires: systemsResult.headers.get('Expires'),
				lastModified: systemsResult.headers.get('Last-Modified'),
			},
			raw: {
				solar_systems: regionSystems,
			},
			summary: sovereigntySystemSummary,
		},
		sovereigntyHubs: hubsListing
			? {
					count: regionHubListing.length,
					pages: hubsListing.pages,
					rawListing: regionHubListing,
					rawDetails: hubDetails,
					alliances: [...allianceDetailsById.entries()].map(([allianceId, alliance]) => ({
						allianceId,
						allianceName: alliance?.name ?? null,
						allianceTicker: alliance?.ticker ?? null,
					})),
					comparison: hubComparison,
					mismatches,
				}
			: null,
	}

	process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)

	if (mismatches.length > 0) {
		process.stderr.write(`\nFound ${mismatches.length} controller alliance mismatches.\n`)
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack ?? error.message : String(error))
	process.exit(1)
})
