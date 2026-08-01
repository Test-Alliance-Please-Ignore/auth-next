#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ALLIANCE_ID = 498125261
const DEFAULT_BASE_URL = 'https://esi.evetech.net'
const DEFAULT_COMPATIBILITY_DATE = '2026-05-19'
const EVE_OAUTH_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const USER_AGENT = 'pleaseignore.app sovereignty diagnostic'

function parseId(value) {
	const id = Number(value)
	if (!Number.isSafeInteger(id) || id <= 0) {
		throw new Error(`Invalid owner ID: ${value}`)
	}

	return id
}

function parseArgs(args) {
	const options = {
		baseUrl: DEFAULT_BASE_URL,
		compatibilityDate: DEFAULT_COMPATIBILITY_DATE,
		checkStructures: false,
		json: false,
		ownerId: DEFAULT_ALLIANCE_ID,
		ownerType: 'alliance',
	}

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]
		switch (argument) {
			case '--alliance-id':
				if (!args[index + 1]) {
					throw new Error('--alliance-id requires a value')
				}
				if (options.ownerType === 'corporation') {
					throw new Error('--alliance-id and --corporation-id cannot be used together')
				}
				options.ownerType = 'alliance'
				options.ownerId = parseId(args[++index])
				break
			case '--corporation-id':
				if (!args[index + 1]) {
					throw new Error('--corporation-id requires a value')
				}
				if (options.ownerType === 'alliance' && options.ownerId !== DEFAULT_ALLIANCE_ID) {
					throw new Error('--alliance-id and --corporation-id cannot be used together')
				}
				options.ownerType = 'corporation'
				options.ownerId = parseId(args[++index])
				break
			case '--base-url':
				if (!args[index + 1]) {
					throw new Error('--base-url requires a value')
				}
				options.baseUrl = args[++index].replace(/\/+$/, '')
				break
			case '--compatibility-date':
				if (!args[index + 1]) {
					throw new Error('--compatibility-date requires a value')
				}
				options.compatibilityDate = args[++index]
				break
			case '--check-structures':
				options.checkStructures = true
				break
			case '--json':
				options.json = true
				break
			case '--help':
				console.log(`Usage: node scripts/diagnose-sovereignty-alliance.mjs [options]

Count sovereignty systems owned by an alliance or corporation using ESI's public endpoint.

Options:
  --alliance-id <id>  Alliance to inspect (default: ${DEFAULT_ALLIANCE_ID})
  --corporation-id <id>
                      Corporation to inspect instead of an alliance
  --base-url <url>    ESI base URL (default: ${DEFAULT_BASE_URL})
  --compatibility-date <date>
                      ESI compatibility date (default: ${DEFAULT_COMPATIBILITY_DATE})
  --check-structures  Refresh the ESI token and list/enrich all corporation sovereignty hubs
  --json              Print structured JSON, including matching system IDs
  --help              Show this help text`)
				process.exit(0)
			default:
				throw new Error(`Unknown argument: ${argument}`)
		}
	}

	return options
}

function isRecord(value) {
	return typeof value === 'object' && value !== null
}

function parseEnvValue(rawValue) {
	let value = ''
	let quote = null

	for (let index = 0; index < rawValue.length; index += 1) {
		const character = rawValue[index]
		if (quote) {
			if (character === quote) {
				quote = null
			} else {
				value += character
			}
			continue
		}

		if (character === '"' || character === "'") {
			quote = character
		} else if (character === '#' && (index === 0 || /\s/.test(rawValue[index - 1]))) {
			break
		} else {
			value += character
		}
	}

	return value.trim()
}

function loadEnvFile() {
	const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env')

	try {
		const envContent = readFileSync(envPath, 'utf8')
		for (const line of envContent.split('\n')) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) continue

			const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
			if (!match) continue

			const key = match[1].trim()
			const value = parseEnvValue(match[2])

			if (!process.env[key]) process.env[key] = value
		}
	} catch {
		// The environment file is optional when the public-only check is used.
	}
}

function getRequiredEnv(name) {
	const value = process.env[name]?.trim()
	if (!value) throw new Error(`Missing ${name} in .env or the process environment`)
	return value
}

async function fetchJson(url, init, label) {
	const response = await fetch(url, init)
	if (!response.ok) {
		const body = await response.text()
		throw new Error(`${label} failed: ${response.status} ${response.statusText} - ${body}`)
	}

	return {
		data: await response.json(),
		headers: response.headers,
	}
}

async function refreshAccessToken() {
	const metadataResult = await fetchJson(
		EVE_OAUTH_METADATA_URL,
		{
			headers: {
				Accept: 'application/json',
				'User-Agent': USER_AGENT,
			},
		},
		'GET /.well-known/oauth-authorization-server'
	)
	if (!isRecord(metadataResult.data) || typeof metadataResult.data.token_endpoint !== 'string') {
		throw new Error('OAuth metadata did not include a token endpoint')
	}

	const clientId = getRequiredEnv('DIAGNOSTIC_EVE_SSO_CLIENT_ID')
	const clientSecret = getRequiredEnv('DIAGNOSTIC_EVE_SSO_CLIENT_SECRET')
	const refreshToken = getRequiredEnv('DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN')
	const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
	const response = await fetch(metadataResult.data.token_endpoint, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': USER_AGENT,
		},
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
		}),
	})

	if (!response.ok) {
		const body = await response.text()
		throw new Error(`Refresh token exchange failed: ${response.status} ${response.statusText} - ${body}`)
	}

	const payload = await response.json()
	if (!isRecord(payload) || typeof payload.access_token !== 'string') {
		throw new Error('Refresh token exchange did not return an access token')
	}

	return payload.access_token
}

async function fetchCorporationSovereigntyHubs(corporationId, accessToken, baseUrl, compatibilityDate) {
	const headers = {
		Accept: 'application/json',
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': USER_AGENT,
		'X-Compatibility-Date': compatibilityDate,
	}
	const firstPage = await fetchJson(
		`${baseUrl}/corporations/${corporationId}/structures/sovereignty-hubs?page=1`,
		{ headers },
		'GET /corporations/{corporation_id}/structures/sovereignty-hubs?page=1'
	)

	if (!isRecord(firstPage.data) || !Array.isArray(firstPage.data.sovereignty_hubs)) {
		throw new Error('ESI returned an unexpected sovereignty hubs listing response')
	}

	const totalPages = Number(firstPage.headers.get('X-Pages') ?? '1')
	if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
		throw new Error(`ESI returned an invalid sovereignty hubs page count: ${totalPages}`)
	}

	const listing = [...firstPage.data.sovereignty_hubs]
	for (let page = 2; page <= totalPages; page += 1) {
		const pageResult = await fetchJson(
			`${baseUrl}/corporations/${corporationId}/structures/sovereignty-hubs?page=${page}`,
			{ headers },
			`GET /corporations/{corporation_id}/structures/sovereignty-hubs?page=${page}`
		)
		if (!isRecord(pageResult.data) || !Array.isArray(pageResult.data.sovereignty_hubs)) {
			throw new Error(`ESI returned an unexpected response for sovereignty hubs page ${page}`)
		}
		listing.push(...pageResult.data.sovereignty_hubs)
	}

	if (
		!listing.every(
			(hub) =>
				isRecord(hub) &&
				Number.isSafeInteger(hub.id) &&
				Number.isSafeInteger(hub.solar_system_id)
		)
	) {
		throw new Error(
			'ESI returned a sovereignty hub listing entry without valid structure and solar-system IDs'
		)
	}

	return { listing, pages: totalPages }
}

async function enrichCorporationSovereigntyHubs(
	corporationId,
	accessToken,
	baseUrl,
	compatibilityDate,
	hubs
) {
	const headers = {
		Accept: 'application/json',
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': USER_AGENT,
		'X-Compatibility-Date': compatibilityDate,
	}

	const results = await Promise.all(
		hubs.map(async (hub) => {
			try {
				const result = await fetchJson(
					`${baseUrl}/corporations/${corporationId}/structures/sovereignty-hubs/${hub.id}`,
					{ headers },
					`GET /corporations/{corporation_id}/structures/sovereignty-hubs/${hub.id}`
				)
				const detail = result.data
				return {
					detail:
						isRecord(detail) && Number.isSafeInteger(detail.id)
							? {
								id: detail.id,
								solarSystemId: detail.solar_system_id,
								controllerAllianceId: detail.controller_alliance_id ?? null,
							}
							: null,
					hubId: hub.id,
					error: null,
				}
			} catch (error) {
				return {
					detail: null,
					hubId: hub.id,
					error: error instanceof Error ? error.message : String(error),
				}
			}
		})
	)

	return {
		attemptedCount: results.length,
		succeededCount: results.filter((result) => result.detail !== null).length,
		failedCount: results.filter((result) => result.error !== null || result.detail === null).length,
		details: results.flatMap((result) => (result.detail ? [result.detail] : [])),
		failures: results
			.filter((result) => result.error !== null || result.detail === null)
			.map(({ hubId, error }) => ({ hubId, error: error ?? 'Invalid detail response' })),
	}
}

async function main() {
	loadEnvFile()
	const options = parseArgs(process.argv.slice(2))
	if (options.checkStructures && options.ownerType !== 'corporation') {
		throw new Error('--check-structures requires --corporation-id')
	}

	const baseUrl = options.baseUrl.replace(/\/+$/, '')
	const endpoint = `${baseUrl}/sovereignty/systems/`
	const response = await fetch(endpoint, {
		headers: {
			Accept: 'application/json',
			'X-Compatibility-Date': options.compatibilityDate,
			'User-Agent': USER_AGENT,
		},
	})

	if (!response.ok) {
		throw new Error(`ESI request failed: ${response.status} ${response.statusText}`)
	}

	const payload = await response.json()
	if (!isRecord(payload) || !Array.isArray(payload.solar_systems)) {
		throw new Error('ESI returned an unexpected sovereignty systems response')
	}

	const matchingSystems = payload.solar_systems.filter(
		(system) =>
			isRecord(system) &&
			isRecord(system.claim) &&
			isRecord(system.claim.alliance) &&
			system.claim.alliance[`${options.ownerType}_id`] === options.ownerId
	)
	const systemIds = matchingSystems.map((system) => system.solar_system_id)

	if (!systemIds.every((systemId) => Number.isSafeInteger(systemId))) {
		throw new Error('ESI returned a matching sovereignty system without a valid system ID')
	}

	systemIds.sort((left, right) => left - right)

	const result = {
		ownerId: options.ownerId,
		ownerType: options.ownerType,
		ownedSystemCount: matchingSystems.length,
		systemIds,
	}

	if (options.checkStructures) {
		const corporationId = options.ownerId
		const accessToken = await refreshAccessToken()
		const hubsListing = await fetchCorporationSovereigntyHubs(
			corporationId,
			accessToken,
			baseUrl,
			options.compatibilityDate
		)
		const enrichment = await enrichCorporationSovereigntyHubs(
			corporationId,
			accessToken,
			baseUrl,
			options.compatibilityDate,
			hubsListing.listing
		)
		const publicSystemIdSet = new Set(systemIds)
		const hubSystemIds = hubsListing.listing.map((hub) => hub.solar_system_id)
		const hubSystemIdSet = new Set(hubSystemIds)
		const missingFromHubListing = systemIds.filter((systemId) => !hubSystemIdSet.has(systemId))
		const missingFromPublicListing = hubSystemIds.filter(
			(systemId) => !publicSystemIdSet.has(systemId)
		)

		result.structures = {
			pages: hubsListing.pages,
			listedCount: hubsListing.listing.length,
			listedIds: hubsListing.listing.map((hub) => hub.id),
			listedSystemIds: [...hubSystemIdSet].sort((left, right) => left - right),
			systemListingMatch: {
				matches:
					missingFromHubListing.length === 0 &&
					missingFromPublicListing.length === 0 &&
					publicSystemIdSet.size === systemIds.length &&
					hubSystemIdSet.size === hubSystemIds.length,
				publicSystemCount: publicSystemIdSet.size,
				hubSystemCount: hubSystemIdSet.size,
				missingFromHubListing,
				missingFromPublicListing,
			},
			...enrichment,
		}
	}

	if (options.json) {
		console.log(JSON.stringify(result, null, 2))
		return
	}

	const ownerLabel = options.ownerType === 'alliance' ? 'Alliance' : 'Corporation'
	console.log(`${ownerLabel} ${result.ownerId} owns ${result.ownedSystemCount} sovereignty systems.`)
	if (systemIds.length > 0) {
		console.log(`System IDs: ${systemIds.join(', ')}`)
	}
	if (result.structures) {
		console.log(
			`Sovereignty hub listing: ${result.structures.listedCount} structures across ${result.structures.pages} page(s).`
		)
		const systemListingMatch = result.structures.systemListingMatch
		console.log(
			`Sovereignty system listing match: ${systemListingMatch.matches ? 'yes' : 'no'} (${systemListingMatch.publicSystemCount} public, ${systemListingMatch.hubSystemCount} hub).`
		)
		if (!systemListingMatch.matches) {
			console.log(
				`Missing from hub listing: ${JSON.stringify(systemListingMatch.missingFromHubListing)}`
			)
			console.log(
				`Missing from public listing: ${JSON.stringify(systemListingMatch.missingFromPublicListing)}`
			)
		}
		console.log(
			`Sovereignty hub enrichment: ${result.structures.succeededCount}/${result.structures.attemptedCount} succeeded.`
		)
		if (result.structures.failedCount > 0) {
			console.log(`Enrichment failures: ${JSON.stringify(result.structures.failures)}`)
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	process.exitCode = 1
})
