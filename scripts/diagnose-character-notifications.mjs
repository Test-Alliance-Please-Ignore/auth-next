#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ESI_BASE_URL = 'https://esi.evetech.net'
const EVE_OAUTH_METADATA_URL = 'https://login.eveonline.com/.well-known/oauth-authorization-server'
const EVE_SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify'
const DEFAULT_COMPATIBILITY_DATE = '2026-05-19'
const USER_AGENT = 'pleaseignore.app character notifications diagnostic/1.0'
const ESI_HOSTNAME = new URL(ESI_BASE_URL).hostname
const EVE_SSO_HOSTNAME = new URL(EVE_OAUTH_METADATA_URL).hostname

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

function validateCharacterId(value) {
	if (!/^\d+$/.test(value) || value === '0') {
		throw new Error(`Invalid character ID: ${value}`)
	}
	return value
}

function validateOfficialHttpsUrl(value, hostname, label, preservePath = false) {
	let url
	try {
		url = new URL(value)
	} catch {
		throw new Error(`Invalid ${label}: ${value}`)
	}

	if (
		url.protocol !== 'https:' ||
		url.hostname !== hostname ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(`${label} must be an HTTPS URL on ${hostname}`)
	}

	return preservePath ? url.href : url.origin
}

function parseArgs(args) {
	const parsedArgs = args[0] === '--' ? args.slice(1) : args
	let characterId = process.env.DIAGNOSTIC_CHARACTER_ID?.trim()
	let baseUrl = ESI_BASE_URL
	let compatibilityDate = DEFAULT_COMPATIBILITY_DATE

	for (let index = 0; index < parsedArgs.length; index += 1) {
		const argument = parsedArgs[index]
		if (argument === '--character-id' || argument === '--character') {
			characterId = parsedArgs[++index]
		} else if (argument === '--base-url') {
			baseUrl = parsedArgs[++index] ?? baseUrl
		} else if (argument === '--compatibility-date') {
			compatibilityDate = parsedArgs[++index] ?? compatibilityDate
		} else if (argument === '--help' || argument === '-h') {
			console.log(`Usage: node scripts/diagnose-character-notifications.mjs [options]

Required environment variables:
  DIAGNOSTIC_EVE_SSO_CLIENT_ID
  DIAGNOSTIC_EVE_SSO_CLIENT_SECRET
  DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN

Character selection:
  DIAGNOSTIC_CHARACTER_ID       Optional character ID (or pass --character-id)
                                Omit to resolve it from the diagnostic token

Options:
  --character-id <id>            Character ID to inspect
  --base-url <url>               ESI base URL (default: ${ESI_BASE_URL})
  --compatibility-date <date>    X-Compatibility-Date override (default: ${DEFAULT_COMPATIBILITY_DATE})
  --help                         Show this help text`)
			process.exit(0)
		} else {
			throw new Error(`Unknown argument: ${argument}`)
		}
	}

	return {
		characterId: characterId ? validateCharacterId(characterId) : null,
		baseUrl: validateOfficialHttpsUrl(baseUrl, ESI_HOSTNAME, 'ESI base URL'),
		compatibilityDate,
	}
}

function isRecord(value) {
	return typeof value === 'object' && value !== null
}

async function readResponse(response, label) {
	const bodyText = await response.text()
	let payload

	try {
		payload = JSON.parse(bodyText)
	} catch {
		payload = bodyText
	}

	if (!response.ok) {
		const detail = typeof payload === 'string' ? payload.slice(0, 1000) : JSON.stringify(payload)
		throw new Error(`${label} failed: ${response.status} ${response.statusText} - ${detail}`)
	}

	return { payload, response }
}

async function refreshAccessToken() {
	const metadataResponse = await fetch(EVE_OAUTH_METADATA_URL, {
		headers: {
			Accept: 'application/json',
			'User-Agent': USER_AGENT,
		},
	})
	const { payload: metadata } = await readResponse(
		metadataResponse,
		'GET /.well-known/oauth-authorization-server'
	)

	if (!isRecord(metadata) || typeof metadata.token_endpoint !== 'string') {
		throw new Error('OAuth metadata did not include a token endpoint')
	}
	const tokenEndpoint = validateOfficialHttpsUrl(
		metadata.token_endpoint,
		EVE_SSO_HOSTNAME,
		'OAuth token endpoint',
		true
	)

	const clientId = getRequiredEnv('DIAGNOSTIC_EVE_SSO_CLIENT_ID')
	const clientSecret = getRequiredEnv('DIAGNOSTIC_EVE_SSO_CLIENT_SECRET')
	const refreshToken = getRequiredEnv('DIAGNOSTIC_EVE_SSO_REFRESH_TOKEN')
	const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
	const response = await fetch(tokenEndpoint, {
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
	const { payload } = await readResponse(response, 'Refresh token exchange')

	if (!isRecord(payload) || typeof payload.access_token !== 'string') {
		throw new Error('Refresh token exchange did not return an access token')
	}

	return payload.access_token
}

async function resolveCharacterId(accessToken) {
	const response = await fetch(EVE_SSO_VERIFY_URL, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
			'User-Agent': USER_AGENT,
		},
	})
	const { payload } = await readResponse(response, 'EVE SSO token verification')
	const characterId = isRecord(payload) ? (payload.CharacterID ?? payload.character_id) : null

	if (typeof characterId !== 'number' && typeof characterId !== 'string') {
		throw new Error('EVE SSO token verification did not return a character ID')
	}

	return validateCharacterId(String(characterId))
}

async function fetchNotifications(config, accessToken) {
	const response = await fetch(`${config.baseUrl}/characters/${config.characterId}/notifications`, {
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${accessToken}`,
			'User-Agent': USER_AGENT,
			'X-Compatibility-Date': config.compatibilityDate,
		},
	})

	const result = await readResponse(response, `GET /characters/${config.characterId}/notifications`)

	return {
		status: response.status,
		responseHeaders: {
			cacheControl: response.headers.get('Cache-Control'),
			contentType: response.headers.get('Content-Type'),
			etag: response.headers.get('ETag'),
			lastModified: response.headers.get('Last-Modified'),
			xCompatibilityDate: response.headers.get('X-Compatibility-Date'),
		},
		payload: result.payload,
	}
}

async function main() {
	loadEnvFile()
	const config = parseArgs(process.argv.slice(2))
	const accessToken = await refreshAccessToken()
	const characterId = config.characterId ?? (await resolveCharacterId(accessToken))
	const result = await fetchNotifications({ ...config, characterId }, accessToken)

	process.stdout.write(
		`${JSON.stringify(
			{
				character_id: characterId,
				endpoint: `/characters/${characterId}/notifications`,
				compatibility_date: config.compatibilityDate,
				...result,
			},
			null,
			2
		)}\n`
	)
}

main().catch((error) => {
	console.error(
		'[character-notifications-diagnostic]',
		error instanceof Error ? error.message : String(error)
	)
	process.exitCode = 1
})
