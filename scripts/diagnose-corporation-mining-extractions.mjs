#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ESI_BASE_URL = 'https://esi.evetech.net'
const EVE_OAUTH_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const DEFAULT_COMPATIBILITY_DATE = '2026-05-19'
const USER_AGENT = 'auth-next corporation mining extraction diagnostic/1.0'

const MINING_CITADEL_TYPES = new Map([
	['35835', 'Athanor'],
	['35836', 'Tatara'],
])

function parseEnvValue(rawValue) {
	let value = ''
	let quote = null

	for (let index = 0; index < rawValue.length; index += 1) {
		const character = rawValue[index]
		if (quote) {
			if (character === quote) quote = null
			else value += character
			continue
		}

		if (character === '"' || character === "'") quote = character
		else if (character === '#' && (index === 0 || /\s/.test(rawValue[index - 1]))) break
		else value += character
	}

	return value.trim()
}

function loadEnvFile() {
	const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
	const envPath = resolve(rootDir, '.env')

	try {
		for (const line of readFileSync(envPath, 'utf8').split('\n')) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith('#')) continue

			const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
			if (!match) continue

			const [, key, rawValue] = match
			if (!process.env[key]) process.env[key] = parseEnvValue(rawValue)
		}
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error
	}
}

function getRequiredEnv(name) {
	const value = process.env[name]?.trim()
	if (!value) throw new Error(`Missing ${name} in .env or the process environment`)
	return value
}

function validateCorporationId(value) {
	if (!/^\d+$/.test(value) || Number(value) <= 0) {
		throw new Error(`Invalid DIAGNOSTIC_CORPORATION_ID: ${value}`)
	}
	return value
}

function parseArgs(args) {
	const parsedArgs = args[0] === '--' ? args.slice(1) : args
	let baseUrl = ESI_BASE_URL
	let compatibilityDate = DEFAULT_COMPATIBILITY_DATE

	for (let index = 0; index < parsedArgs.length; index += 1) {
		const argument = parsedArgs[index]
		if (argument === '--base-url') {
			baseUrl = parsedArgs[++index] ?? baseUrl
		} else if (argument === '--compatibility-date') {
			compatibilityDate = parsedArgs[++index] ?? compatibilityDate
		} else if (argument === '--help' || argument === '-h') {
			console.log(`Usage: node scripts/diagnose-corporation-mining-extractions.mjs [options]

Required environment variables:
  DIAGNOSTIC_EVE_SSO_CLIENT_ID
  DIAGNOSTIC_EVE_SSO_CLIENT_SECRET
  DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN
  DIAGNOSTIC_CORPORATION_ID

Options:
  --base-url <url>                 ESI base URL (default: ${ESI_BASE_URL})
  --compatibility-date <date>      X-Compatibility-Date override (default: ${DEFAULT_COMPATIBILITY_DATE})
  --help                           Show this help text`)
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${argument}`)
		}
	}

	return {
		baseUrl: baseUrl.replace(/\/+$/, ''),
		compatibilityDate,
		corporationId: validateCorporationId(getRequiredEnv('DIAGNOSTIC_CORPORATION_ID')),
	}
}

function isRecord(value) {
	return typeof value === 'object' && value !== null
}

async function fetchJson(url, init, label) {
	const response = await fetch(url, init)
	const bodyText = await response.text()
	let body

	try {
		body = JSON.parse(bodyText)
	} catch {
		body = bodyText
	}

	if (!response.ok) {
		const detail = typeof body === 'string' ? body.slice(0, 1000) : JSON.stringify(body)
		throw new Error(`${label} failed: ${response.status} ${response.statusText} - ${detail}`)
	}

	return { data: body, headers: response.headers }
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
		throw new Error(`Refresh token exchange failed: ${response.status} ${response.statusText}`)
	}

	const body = await response.json()
	if (!isRecord(body) || typeof body.access_token !== 'string') {
		throw new Error('Refresh token exchange did not return an access token')
	}

	return body.access_token
}

function createEsiHeaders(accessToken, compatibilityDate) {
	return {
		Accept: 'application/json',
		Authorization: `Bearer ${accessToken}`,
		'User-Agent': USER_AGENT,
		'X-Compatibility-Date': compatibilityDate,
	}
}

function getTotalPages(headers, label) {
	const rawPages = headers.get('X-Pages') ?? '1'
	const totalPages = Number(rawPages)
	if (!Number.isSafeInteger(totalPages) || totalPages < 1) {
		throw new Error(`${label} returned an invalid X-Pages value: ${rawPages}`)
	}
	return totalPages
}

async function fetchAllPages({ baseUrl, path, headers, label, isArray }) {
	const rows = []
	let totalPages = 0

	for (let page = 1; page <= (totalPages || 1); page += 1) {
		const result = await fetchJson(
			`${baseUrl}${path}?page=${page}`,
			{ headers },
			`${label} page ${page}`
		)

		if (!isArray(result.data)) {
			throw new Error(`${label} page ${page} returned a non-array response`)
		}

		rows.push(...result.data)
		if (page === 1) totalPages = getTotalPages(result.headers, label)
	}

	return { rows, totalPages }
}

async function fetchCorporationStructures(config, accessToken) {
	const result = await fetchAllPages({
		baseUrl: config.baseUrl,
		path: `/corporations/${config.corporationId}/structures`,
		headers: createEsiHeaders(accessToken, config.compatibilityDate),
		label: 'Corporation structures',
		isArray: Array.isArray,
	})

	return {
		...result,
		rows: result.rows.filter((structure) => isRecord(structure)),
	}
}

async function fetchMiningExtractions(config, accessToken) {
	return fetchAllPages({
		baseUrl: config.baseUrl,
		path: `/corporation/${config.corporationId}/mining/extractions`,
		headers: createEsiHeaders(accessToken, config.compatibilityDate),
		label: 'Mining extractions',
		isArray: Array.isArray,
	})
}

async function fetchMiningObservers(config, accessToken) {
	return fetchAllPages({
		baseUrl: config.baseUrl,
		path: `/corporation/${config.corporationId}/mining/observers`,
		headers: createEsiHeaders(accessToken, config.compatibilityDate),
		label: 'Corporation mining observers',
		isArray: Array.isArray,
	})
}

async function fetchMiningObserverLedger(config, accessToken, observerId) {
	return fetchAllPages({
		baseUrl: config.baseUrl,
		path: `/corporation/${config.corporationId}/mining/observers/${observerId}`,
		headers: createEsiHeaders(accessToken, config.compatibilityDate),
		label: `Mining observer ${observerId}`,
		isArray: Array.isArray,
	})
}

function getMiningCitadels(structures) {
	return structures.flatMap((structure) => {
		const typeId = String(structure.type_id ?? '')
		const typeName = MINING_CITADEL_TYPES.get(typeId)
		if (!typeName) return []

		return [
			{
				structure_id: String(structure.structure_id),
				type_id: typeId,
				type_name: typeName,
				name: structure.name ?? null,
				state: structure.state ?? null,
				system_id: structure.system_id ?? null,
				corporation_id: structure.corporation_id ?? null,
			},
		]
	})
}

function summarizeStructure(structure) {
	return {
		structure_id: structure.structure_id ?? null,
		type_id: structure.type_id ?? null,
		name: structure.name ?? null,
		state: structure.state ?? null,
		system_id: structure.system_id ?? null,
		corporation_id: structure.corporation_id ?? null,
	}
}

function getExtractionStructureId(extraction) {
	return isRecord(extraction) && extraction.structure_id !== undefined
		? String(extraction.structure_id)
		: null
}

async function main() {
	loadEnvFile()
	const config = parseArgs(process.argv.slice(2))
	const accessToken = await refreshAccessToken()
	const structuresResult = await fetchCorporationStructures(config, accessToken)
	const miningCitadels = getMiningCitadels(structuresResult.rows)
	const extractionsResult = await fetchMiningExtractions(config, accessToken)
	const observersResult = await fetchMiningObservers(config, accessToken)
	const miningCitadelIds = new Set(miningCitadels.map((structure) => structure.structure_id))
	const extractionStructureIds = new Set(
		extractionsResult.rows.map(getExtractionStructureId).filter(Boolean)
	)
	const miningObservers = observersResult.rows
		.filter((observer) => isRecord(observer))
		.map((observer) => ({
			...observer,
			observer_id: observer.observer_id === undefined ? null : String(observer.observer_id),
		}))
	const matchingMiningObservers = miningObservers.filter(
		(observer) => observer.observer_id !== null && miningCitadelIds.has(observer.observer_id)
	)
	const observerLedgers = []
	for (const observer of matchingMiningObservers) {
		try {
			const ledger = await fetchMiningObserverLedger(config, accessToken, observer.observer_id)
			observerLedgers.push({
				observer_id: observer.observer_id,
				structure_id: observer.observer_id,
				pages: ledger.totalPages,
				count: ledger.rows.length,
				rows: ledger.rows,
			})
		} catch (error) {
			observerLedgers.push({
				observer_id: observer.observer_id,
				structure_id: observer.observer_id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	const payload = {
		corporation_id: config.corporationId,
		compatibility_date: config.compatibilityDate,
		structures: {
			pages: structuresResult.totalPages,
			count: structuresResult.rows.length,
			all: structuresResult.rows.map(summarizeStructure),
			mining_citadels: miningCitadels,
		},
		mining_extractions: {
			pages: extractionsResult.totalPages,
			count: extractionsResult.rows.length,
			rows: extractionsResult.rows,
			matched_mining_citadel_count: extractionsResult.rows.filter((extraction) =>
				miningCitadelIds.has(getExtractionStructureId(extraction))
			).length,
			missing_extraction_structure_ids: miningCitadels
				.filter((structure) => !extractionStructureIds.has(structure.structure_id))
				.map((structure) => structure.structure_id),
			unexpected_structure_ids: [...extractionStructureIds].filter(
				(structureId) => !miningCitadelIds.has(structureId)
			),
		},
		mining_observers: {
			pages: observersResult.totalPages,
			count: miningObservers.length,
			rows: miningObservers,
			matched_mining_citadel_count: matchingMiningObservers.length,
			unmatched_mining_citadel_ids: miningCitadels
				.filter(
					(structure) =>
						!matchingMiningObservers.some(
							(observer) => observer.observer_id === structure.structure_id
						)
				)
				.map((structure) => structure.structure_id),
			ledgers: observerLedgers,
		},
	}

	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

main().catch((error) => {
	console.error(
		'[corporation-mining-extractions-diagnostic]',
		error instanceof Error ? error.message : String(error)
	)
	process.exitCode = 1
})
