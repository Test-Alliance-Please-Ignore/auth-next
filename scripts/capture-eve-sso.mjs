#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EVE_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const EVE_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const STATE_TTL_MS = 10 * 60 * 1000
const DEFAULT_PORT = 8787
const DEFAULT_BIND_HOST = '127.0.0.1'

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

function requiredEnv(name) {
	const value = process.env[name]?.trim()
	if (!value) throw new Error(`Missing ${name} in .env or the process environment`)
	return value
}

function parseArgs(args) {
	const parsedArgs = args[0] === '--' ? args.slice(1) : args

	const options = {
		bindHost: DEFAULT_BIND_HOST,
		port: DEFAULT_PORT,
	}

	for (let index = 0; index < parsedArgs.length; index += 1) {
		const argument = parsedArgs[index]
		if (argument === '--help' || argument === '-h') {
			console.error(`Usage: node scripts/capture-eve-sso.mjs [options]

Required environment variables:
  EVE_SSO_CAPTURE_CLIENT_ID
  EVE_SSO_CAPTURE_CLIENT_SECRET
  EVE_SSO_CAPTURE_CALLBACK_URL
  EVE_SSO_CAPTURE_SCOPES       Comma-separated EVE SSO scopes
  EVE_SSO_CAPTURE_ALLOWED_HOST Exact Cloudflare tunnel host

Optional environment variables:
  None

Options:
  --bind-host <host>           Override the bind host
  --port <port>                Override the local listen port
  --help                       Show this help text`)
			process.exit(0)
		}

		if (argument === '--bind-host' || argument === '--port') {
			const value = parsedArgs[++index]
			if (!value) throw new Error(`${argument} requires a value`)
			if (argument === '--bind-host') options.bindHost = value
			else options.port = Number(value)
			continue
		}

		throw new Error(`Unknown argument: ${argument}`)
	}

	if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
		throw new Error(`Invalid listen port: ${options.port}`)
	}

	return options
}

function parseAllowedHost(rawHost) {
	const candidate = rawHost.includes('://') ? rawHost : `https://${rawHost}`
	const url = new URL(candidate)
	if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new Error('EVE_SSO_CAPTURE_ALLOWED_HOST must contain only a hostname and optional port')
	}

	return {
		hostname: url.hostname.toLowerCase(),
		port: url.port || null,
	}
}

function parseConfig(options) {
	const callbackUrl = new URL(requiredEnv('EVE_SSO_CAPTURE_CALLBACK_URL'))
	if (!['http:', 'https:'].includes(callbackUrl.protocol)) {
		throw new Error('EVE_SSO_CAPTURE_CALLBACK_URL must use http or https')
	}
	if (callbackUrl.search || callbackUrl.hash) {
		throw new Error('EVE_SSO_CAPTURE_CALLBACK_URL must not contain a query string or fragment')
	}

	const allowedHost = parseAllowedHost(requiredEnv('EVE_SSO_CAPTURE_ALLOWED_HOST'))
	if (callbackUrl.hostname.toLowerCase() !== allowedHost.hostname) {
		throw new Error('The callback URL hostname must match EVE_SSO_CAPTURE_ALLOWED_HOST')
	}
	if (allowedHost.port && callbackUrl.port !== allowedHost.port) {
		throw new Error('The callback URL port must match EVE_SSO_CAPTURE_ALLOWED_HOST')
	}

	const scopes = [
		...new Set(
			requiredEnv('EVE_SSO_CAPTURE_SCOPES')
				.split(',')
				.map((scope) => scope.trim())
				.filter(Boolean)
		),
	]
	if (scopes.length === 0) throw new Error('EVE_SSO_CAPTURE_SCOPES must contain at least one scope')

	return {
		clientId: requiredEnv('EVE_SSO_CAPTURE_CLIENT_ID'),
		clientSecret: requiredEnv('EVE_SSO_CAPTURE_CLIENT_SECRET'),
		callbackUrl,
		allowedHost,
		scopes,
		...options,
	}
}

function getRequestUrl(request, host) {
	return new URL(request.url || '/', `http://${host}`)
}

function isAllowedRequestHost(request, config) {
	const hostHeader = request.headers.host
	if (!hostHeader) return false

	try {
		const requestHost = new URL(`http://${hostHeader}`)
		return (
			requestHost.hostname.toLowerCase() === config.allowedHost.hostname &&
			(!config.allowedHost.port || requestHost.port === config.allowedHost.port)
		)
	} catch {
		return false
	}
}

function createState() {
	return randomBytes(32).toString('base64url')
}

function buildAuthorizationUrl(config, state) {
	const url = new URL(EVE_AUTHORIZE_URL)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('client_id', config.clientId)
	url.searchParams.set('redirect_uri', config.callbackUrl.toString())
	url.searchParams.set('scope', config.scopes.join(' '))
	url.searchParams.set('state', state)
	return url
}

function writeResponse(response, status, body, contentType = 'text/html; charset=utf-8') {
	response.writeHead(status, {
		'Cache-Control': 'no-store',
		'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
		'Content-Type': contentType,
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
	})
	response.end(body)
}

function escapeHtml(value) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;')
}

async function exchangeCode(config, code) {
	const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
	const response = await fetch(EVE_TOKEN_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
			'User-Agent': 'auth-next EVE SSO capture utility',
		},
		body: new URLSearchParams({
			code,
			grant_type: 'authorization_code',
			redirect_uri: config.callbackUrl.toString(),
		}),
	})

	const bodyText = await response.text()
	let body
	try {
		body = JSON.parse(bodyText)
	} catch {
		body = { response: bodyText.slice(0, 500) }
	}

	if (!response.ok) {
		const detail = body && typeof body === 'object' ? JSON.stringify(body) : String(body)
		throw new Error(`EVE token exchange failed with ${response.status}: ${detail}`)
	}
	if (!body || typeof body.refresh_token !== 'string' || !body.refresh_token) {
		throw new Error('EVE token exchange did not return a refresh token')
	}

	return body
}

function printCapture(config, tokenResponse) {
	const payload = {
		refresh_token: tokenResponse.refresh_token,
		scope: tokenResponse.scope ?? config.scopes.join(' '),
		token_type: tokenResponse.token_type ?? null,
		expires_in: tokenResponse.expires_in ?? null,
		captured_at: new Date().toISOString(),
	}

	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

function startServer(config) {
	const states = new Map()

	const cleanupStates = () => {
		const cutoff = Date.now() - STATE_TTL_MS
		for (const [state, createdAt] of states) {
			if (createdAt < cutoff) states.delete(state)
		}
	}

	const server = createServer((request, response) => {
		if (!isAllowedRequestHost(request, config)) {
			writeResponse(response, 421, 'Misdirected Request', 'text/plain; charset=utf-8')
			return
		}

		const requestUrl = getRequestUrl(request, request.headers.host)
		const callbackPath = config.callbackUrl.pathname || '/'

		if (request.method !== 'GET') {
			writeResponse(response, 405, 'Method Not Allowed', 'text/plain; charset=utf-8')
			return
		}

		cleanupStates()

		if (requestUrl.pathname === '/') {
			const state = createState()
			states.set(state, Date.now())
			const authorizationUrl = buildAuthorizationUrl(config, state)
			response.writeHead(302, {
				'Cache-Control': 'no-store',
				Location: authorizationUrl.toString(),
			})
			response.end()
			return
		}

		if (requestUrl.pathname !== callbackPath) {
			writeResponse(response, 404, 'Not Found', 'text/plain; charset=utf-8')
			return
		}

		const error = requestUrl.searchParams.get('error')
		if (error) {
			const description = requestUrl.searchParams.get('error_description') || error
			writeResponse(
				response,
				400,
				`<!doctype html><meta charset="utf-8"><title>EVE SSO failed</title><p>${escapeHtml(description)}</p>`
			)
			return
		}

		const state = requestUrl.searchParams.get('state')
		const code = requestUrl.searchParams.get('code')
		if (!state || !code || !states.has(state)) {
			writeResponse(
				response,
				400,
				'<!doctype html><meta charset="utf-8"><title>Invalid callback</title><p>Invalid or expired OAuth callback.</p>'
			)
			return
		}

		states.delete(state)
		void exchangeCode(config, code)
			.then((tokenResponse) => {
				printCapture(config, tokenResponse)
				writeResponse(
					response,
					200,
					'<!doctype html><meta charset="utf-8"><title>EVE SSO complete</title><p>Authentication completed. You may close this window.</p>'
				)
			})
			.catch((exchangeError) => {
				console.error(`[eve-sso-capture] ${exchangeError.message}`)
				writeResponse(
					response,
					502,
					'<!doctype html><meta charset="utf-8"><title>EVE SSO exchange failed</title><p>The token exchange failed. Check the terminal for details.</p>'
				)
			})
	})

	server.listen(config.port, config.bindHost, () => {
		console.error(`[eve-sso-capture] listening on http://${config.bindHost}:${config.port}`)
		console.error(`[eve-sso-capture] open ${config.callbackUrl.origin}/`)
	})

	const shutdown = () => server.close(() => process.exit(0))
	process.once('SIGINT', shutdown)
	process.once('SIGTERM', shutdown)
}

try {
	loadEnvFile()
	startServer(parseConfig(parseArgs(process.argv.slice(2))))
} catch (error) {
	console.error(`[eve-sso-capture] ${error.message}`)
	process.exitCode = 1
}
