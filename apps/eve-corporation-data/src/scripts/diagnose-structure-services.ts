import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_COMPATIBILITY_DATE = '2026-05-19'
const EVE_OAUTH_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const ESI_BASE_URL = 'https://esi.evetech.net'
const USER_AGENT = 'eve-corporation-data-structure-service-diagnostics/1.0'

type OAuthMetadata = {
	token_endpoint: string
}

type RawStructureService = {
	name?: unknown
	state?: unknown
	[key: string]: unknown
}

type RawCorporationStructure = {
	structure_id?: unknown
	type_id?: unknown
	services?: unknown
	[key: string]: unknown
}

type RawCorporationAsset = {
	item_id?: unknown
	location_flag?: unknown
	location_id?: unknown
	location_type?: unknown
	type_id?: unknown
	[key: string]: unknown
}

function loadEnvFile(): void {
	const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env')

	try {
		for (const line of readFileSync(envPath, 'utf8').split('\n')) {
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
				if (commentIndex !== -1) value = value.slice(0, commentIndex).trimEnd()
			}
			process.env[key] = value
		}
	} catch {
		// The environment may already be populated by the shell.
	}
}

function parseArgs(): {
	corporationId: string
	compatibilityDate: string
	includeAssets: boolean
} {
	const args = process.argv.slice(2)
	let corporationId: string | undefined
	let compatibilityDate = DEFAULT_COMPATIBILITY_DATE
	let includeAssets = false

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === '--corp' || arg === '--corporation-id') {
			corporationId = args[++index]
		} else if (arg === '--compatibility-date') {
			compatibilityDate = args[++index] ?? compatibilityDate
		} else if (arg === '--assets') {
			includeAssets = true
		} else if (arg === '--help' || arg === '-h') {
			console.log(
				'Usage: pnpm -F eve-corporation-data diagnose-structure-services --corp <id> [options]'
			)
			console.log('')
			console.log('Options:')
			console.log('  --corp, --corporation-id <id>  Corporation ID to inspect')
			console.log('  --compatibility-date <date>    ESI compatibility date override')
			console.log('  --assets                       Inspect ServiceSlot asset rows as well')
			console.log('')
			console.log('Environment:')
			console.log('  DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN')
			console.log('  DIAGNOSTIC_EVE_SSO_CLIENT_ID')
			console.log('  DIAGNOSTIC_EVE_SSO_CLIENT_SECRET')
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	if (!corporationId) throw new Error('Missing required --corp/--corporation-id value')
	return { corporationId, compatibilityDate, includeAssets }
}

function getRequiredEnv(name: string): string {
	const value = process.env[name]?.trim()
	if (!value) throw new Error(`Missing ${name}`)
	return value
}

async function fetchJson<T>(
	url: string,
	init: RequestInit,
	label: string
): Promise<{
	data: T
	headers: Headers
}> {
	const response = await fetch(url, init)
	if (!response.ok) {
		throw new Error(
			`${label} failed: ${response.status} ${response.statusText} - ${await response.text()}`
		)
	}

	return { data: (await response.json()) as T, headers: response.headers }
}

async function refreshAccessToken(): Promise<string> {
	const metadata = await fetchJson<OAuthMetadata>(
		EVE_OAUTH_METADATA_URL,
		{ headers: { accept: 'application/json', 'User-Agent': USER_AGENT } },
		'GET /.well-known/oauth-authorization-server'
	)
	const clientId = getRequiredEnv('DIAGNOSTIC_EVE_SSO_CLIENT_ID')
	const clientSecret = getRequiredEnv('DIAGNOSTIC_EVE_SSO_CLIENT_SECRET')
	const refreshToken = getRequiredEnv('DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN')
	const credentials = btoa(`${clientId}:${clientSecret}`)
	const response = await fetch(metadata.data.token_endpoint, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': USER_AGENT,
		},
		body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
	})
	if (!response.ok) {
		throw new Error(`Refresh token exchange failed: ${response.status} ${response.statusText}`)
	}

	const body = (await response.json()) as { access_token?: string }
	if (!body.access_token) throw new Error('Refresh token exchange did not return an access token')
	return body.access_token
}

async function fetchCorporationStructures(
	corporationId: string,
	accessToken: string,
	compatibilityDate: string
): Promise<RawCorporationStructure[]> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': USER_AGENT,
		'X-Compatibility-Date': compatibilityDate,
	}
	const structures: RawCorporationStructure[] = []
	const firstPage = await fetchJson<RawCorporationStructure[]>(
		`${ESI_BASE_URL}/corporations/${corporationId}/structures/?page=1`,
		{ headers },
		'GET /corporations/{corporation_id}/structures/?page=1'
	)
	structures.push(...firstPage.data)

	const totalPages = Number(firstPage.headers.get('X-Pages') ?? '1')
	for (let page = 2; page <= totalPages; page += 1) {
		const result = await fetchJson<RawCorporationStructure[]>(
			`${ESI_BASE_URL}/corporations/${corporationId}/structures/?page=${page}`,
			{ headers },
			`GET /corporations/{corporation_id}/structures/?page=${page}`
		)
		structures.push(...result.data)
	}

	return structures
}

async function fetchCorporationAssets(
	corporationId: string,
	accessToken: string,
	compatibilityDate: string
): Promise<RawCorporationAsset[]> {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': USER_AGENT,
		'X-Compatibility-Date': compatibilityDate,
	}
	const assets: RawCorporationAsset[] = []
	const firstPage = await fetchJson<RawCorporationAsset[]>(
		`${ESI_BASE_URL}/corporations/${corporationId}/assets/?page=1`,
		{ headers },
		'GET /corporations/{corporation_id}/assets/?page=1'
	)
	assets.push(...firstPage.data)

	const totalPages = Number(firstPage.headers.get('X-Pages') ?? '1')
	for (let page = 2; page <= totalPages; page += 1) {
		const result = await fetchJson<RawCorporationAsset[]>(
			`${ESI_BASE_URL}/corporations/${corporationId}/assets/?page=${page}`,
			{ headers },
			`GET /corporations/{corporation_id}/assets/?page=${page}`
		)
		assets.push(...result.data)
	}

	return assets
}

function printPayloadShape(structures: readonly RawCorporationStructure[]): void {
	const serviceEntries = structures.flatMap((structure) =>
		Array.isArray(structure.services) ? structure.services : []
	)
	const services = serviceEntries.filter(
		(service): service is RawStructureService => typeof service === 'object' && service !== null
	)
	const serviceNames = new Map<string, number>()
	for (const service of services) {
		const name = typeof service.name === 'string' ? service.name : '<missing name>'
		serviceNames.set(name, (serviceNames.get(name) ?? 0) + 1)
	}
	const serviceKeys = [...new Set(services.flatMap((service) => Object.keys(service)))].sort()
	const structuresWithTypeIds = structures.filter(
		(structure) => structure.type_id !== undefined
	).length
	const servicesWithTypeIds = services.filter((service) => service.type_id !== undefined).length

	console.log(`Structures: ${structures.length}`)
	console.log(`Structures with top-level type_id: ${structuresWithTypeIds}`)
	console.log(`Service entries: ${services.length}`)
	console.log(`Service object keys: ${serviceKeys.join(', ') || '<none>'}`)
	console.log(`Service entries with type_id: ${servicesWithTypeIds}`)
	console.log('Service names:')
	for (const [name, count] of [...serviceNames.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		console.log(`  ${count}x ${name}`)
	}

	console.log('Sample structure service payloads:')
	for (const structure of structures.slice(0, 10)) {
		console.log(
			JSON.stringify({
				structure_id: structure.structure_id,
				type_id: structure.type_id,
				services: structure.services,
			})
		)
	}
}

function printServiceSlotAssets(
	structures: readonly RawCorporationStructure[],
	assets: readonly RawCorporationAsset[]
): void {
	const structureIds = new Set(
		structures
			.map((structure) => structure.structure_id)
			.filter(
				(structureId): structureId is string | number =>
					typeof structureId === 'string' || typeof structureId === 'number'
			)
			.map(String)
	)
	const serviceSlotAssets = assets.filter(
		(asset) =>
			typeof asset.location_flag === 'string' &&
			asset.location_flag.startsWith('ServiceSlot') &&
			asset.location_type === 'item' &&
			structureIds.has(String(asset.location_id))
	)

	console.log(`Assets: ${assets.length}`)
	console.log(`ServiceSlot assets on listed structures: ${serviceSlotAssets.length}`)
	console.log('ServiceSlot asset payloads:')
	for (const asset of serviceSlotAssets) {
		console.log(
			JSON.stringify({
				item_id: asset.item_id,
				location_flag: asset.location_flag,
				location_id: asset.location_id,
				location_type: asset.location_type,
				type_id: asset.type_id,
			})
		)
	}
}

async function main(): Promise<void> {
	loadEnvFile()
	const { corporationId, compatibilityDate, includeAssets } = parseArgs()
	const accessToken = await refreshAccessToken()
	const structures = await fetchCorporationStructures(corporationId, accessToken, compatibilityDate)
	printPayloadShape(structures)
	if (includeAssets) {
		const assets = await fetchCorporationAssets(corporationId, accessToken, compatibilityDate)
		printServiceSlotAssets(structures, assets)
	}
}

main().catch((error) => {
	console.error(
		'Structure service diagnostic failed:',
		error instanceof Error ? error.message : String(error)
	)
	process.exitCode = 1
})
