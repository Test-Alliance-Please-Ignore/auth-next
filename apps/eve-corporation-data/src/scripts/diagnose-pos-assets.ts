import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_COMPATIBILITY_DATE = '2026-05-19'
const EVE_OAUTH_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const ESI_BASE_URL = 'https://esi.evetech.net'
const USER_AGENT = 'eve-corporation-data-pos-asset-diagnostics/1.0'

type OAuthMetadata = {
	token_endpoint: string
}

type RawStarbase = {
	starbase_id?: unknown
	type_id?: unknown
	system_id?: unknown
	moon_id?: unknown
	state?: unknown
	onlined_since?: unknown
	reinforced_until?: unknown
	unanchor_at?: unknown
}

type RawAsset = {
	item_id?: unknown
	is_singleton?: unknown
	location_flag?: unknown
	location_id?: unknown
	location_type?: unknown
	quantity?: unknown
	type_id?: unknown
}

type PageResult<T> = {
	data: T
	headers: Headers
}

type ParsedArgs = {
	corporationId: string
	compatibilityDate: string
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
			if (value.startsWith('"') || value.startsWith("'")) {
				const quote = value[0]
				const closingQuoteIndex = value.indexOf(quote, 1)
				value = closingQuoteIndex >= 0 ? value.slice(1, closingQuoteIndex) : value.slice(1)
			} else {
				const commentIndex = value.indexOf('#')
				if (commentIndex !== -1) value = value.slice(0, commentIndex).trimEnd()
			}
			process.env[key] = value
		}
	} catch {
		// The environment may already be populated by the shell.
	}
}

function getRequiredEnv(name: string): string {
	const value = process.env[name]?.trim()
	if (!value) throw new Error(`Missing ${name}`)
	return value
}

function parseArgs(): ParsedArgs {
	const args = process.argv.slice(2)
	let corporationId = process.env.DIAGNOSTIC_CORPORATION_ID?.trim()
	let compatibilityDate = DEFAULT_COMPATIBILITY_DATE

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === '--') {
			continue
		} else if (arg === '--corp' || arg === '--corporation-id') {
			corporationId = args[++index]
		} else if (arg === '--compatibility-date') {
			compatibilityDate = args[++index] ?? compatibilityDate
		} else if (arg === '--help' || arg === '-h') {
			console.error('Usage: pnpm -F eve-corporation-data diagnose-pos-assets --corp <id> [options]')
			console.error('')
			console.error('Options:')
			console.error('  --corp, --corporation-id <id>  Corporation ID to inspect')
			console.error('  --compatibility-date <date>    ESI compatibility date override')
			console.error('')
			console.error('Environment:')
			console.error('  DIAGNOSTIC_CORPORATION_ID       Optional corporation ID fallback')
			console.error('  DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN')
			console.error('  DIAGNOSTIC_EVE_SSO_CLIENT_ID')
			console.error('  DIAGNOSTIC_EVE_SSO_CLIENT_SECRET')
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${arg}`)
		}
	}

	if (!corporationId)
		throw new Error('Missing --corp/--corporation-id or DIAGNOSTIC_CORPORATION_ID')
	if (!/^\d+$/.test(corporationId)) throw new Error('Corporation ID must contain only digits')

	return { corporationId, compatibilityDate }
}

async function fetchJson<T>(url: string, init: RequestInit, label: string): Promise<PageResult<T>> {
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

function makeHeaders(accessToken: string, compatibilityDate: string): HeadersInit {
	return {
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': USER_AGENT,
		'X-Compatibility-Date': compatibilityDate,
	}
}

async function fetchAllPages<T>(
	path: string,
	headers: HeadersInit,
	label: string
): Promise<{ data: T[]; pages: number }> {
	const firstPage = await fetchJson<T[]>(
		`${ESI_BASE_URL}${path}?page=1`,
		{ headers },
		`${label} page 1`
	)
	const totalPages = Number(firstPage.headers.get('X-Pages') ?? '1')
	if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
		throw new Error(`${label} returned an invalid X-Pages value: ${String(totalPages)}`)
	}

	const rows = [...firstPage.data]
	for (let page = 2; page <= totalPages; page += 1) {
		const result = await fetchJson<T[]>(
			`${ESI_BASE_URL}${path}?page=${page}`,
			{ headers },
			`${label} page ${page}`
		)
		rows.push(...result.data)
	}

	return { data: rows, pages: totalPages }
}

function asString(value: unknown): string | null {
	return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function asNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeStarbase(starbase: RawStarbase) {
	return {
		starbaseId: asString(starbase.starbase_id),
		typeId: asString(starbase.type_id),
		systemId: asString(starbase.system_id),
		moonId: asString(starbase.moon_id),
		state: asString(starbase.state),
		onlinedSince: asString(starbase.onlined_since),
		reinforcedUntil: asString(starbase.reinforced_until),
		unanchorAt: asString(starbase.unanchor_at),
	}
}

function normalizeAsset(asset: RawAsset) {
	return {
		itemId: asString(asset.item_id),
		typeId: asString(asset.type_id),
		quantity: asNumber(asset.quantity),
		isSingleton: asset.is_singleton === true,
		locationId: asString(asset.location_id),
		locationType: asString(asset.location_type),
		locationFlag: asString(asset.location_flag),
	}
}

function countLocationFlags(assets: ReadonlyArray<ReturnType<typeof normalizeAsset>>) {
	const counts = new Map<string, number>()
	for (const asset of assets) {
		const flag = asset.locationFlag ?? '<missing>'
		counts.set(flag, (counts.get(flag) ?? 0) + 1)
	}

	return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)))
}

async function main(): Promise<void> {
	loadEnvFile()
	const { corporationId, compatibilityDate } = parseArgs()
	const accessToken = await refreshAccessToken()
	const headers = makeHeaders(accessToken, compatibilityDate)

	const [starbaseResult, assetResult] = await Promise.all([
		fetchAllPages<RawStarbase>(
			`/corporations/${corporationId}/starbases`,
			headers,
			'GET /corporations/{corporation_id}/starbases'
		),
		fetchAllPages<RawAsset>(
			`/corporations/${corporationId}/assets`,
			headers,
			'GET /corporations/{corporation_id}/assets'
		),
	])

	const starbases = starbaseResult.data.map(normalizeStarbase)
	const starbaseIds = new Set(
		starbases.map((starbase) => starbase.starbaseId).filter((id): id is string => id !== null)
	)
	const assets = assetResult.data.map(normalizeAsset)
	const posAssets = assets.filter(
		(asset) =>
			asset.locationType === 'item' &&
			asset.locationId !== null &&
			starbaseIds.has(asset.locationId)
	)

	const locationFlagCounts = countLocationFlags(posAssets)

	const byStarbase = starbases.map((starbase) => {
		const directAssets = posAssets.filter((asset) => asset.locationId === starbase.starbaseId)
		return {
			...starbase,
			directAssetCount: directAssets.length,
			locationFlagCounts: countLocationFlags(directAssets),
			directAssets,
		}
	})

	console.log(
		JSON.stringify(
			{
				corporationId,
				compatibilityDate,
				structures: {
					endpoint: '/corporations/{corporation_id}/starbases',
					pages: starbaseResult.pages,
					count: starbases.length,
					rows: starbases,
				},
				assets: {
					endpoint: '/corporations/{corporation_id}/assets',
					pages: assetResult.pages,
					allAssetCount: assets.length,
					posAssetCount: posAssets.length,
					locationFlagCounts,
					byStarbase,
				},
			},
			null,
			2
		)
	)
}

main().catch((error) => {
	console.error(
		'POS asset diagnostic failed:',
		error instanceof Error ? error.message : String(error)
	)
	process.exitCode = 1
})
