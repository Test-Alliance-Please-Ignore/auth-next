import { and, eq, lt } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { mumbleTempopCredentialHandoffs, mumbleTempopGuests, mumbleTempops } from '../db/schema'
import { deleteMumbleAccounts, TEMPOP_GROUP_NAME } from './mumble.service'

import type { Env } from '../context'

/** TTL preset labels offered in the UI, mapped to seconds. */
export const TEMPOP_TTL_PRESETS: Record<string, number> = {
	'1h': 60 * 60,
	'4h': 4 * 60 * 60,
	'6h': 6 * 60 * 60,
}

/** Maximum custom TTL in hours. */
export const TEMPOP_MAX_CUSTOM_HOURS = 12
/** Maximum TTL in seconds (12h), enforced server-side. */
export const TEMPOP_MAX_TTL_SECONDS = TEMPOP_MAX_CUSTOM_HOURS * 60 * 60

/** Lifetime of a single-use credential handoff token. */
const CREDENTIAL_HANDOFF_TTL_MS = 60 * 1000

const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_INSERT_ATTEMPTS = 5

export interface TempopCredentialPayload {
	loginName: string
	password: string
	host: string
	port: number
}

export interface CreatedTempop {
	id: string
	shortCode: string
	/** Raw URL token — returned to the creator exactly once, never stored. */
	token: string
	expiresAt: Date
}

function base64url(bytes: Uint8Array): string {
	let binary = ''
	for (const byte of bytes) binary += String.fromCharCode(byte)
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(byteLength = 32): string {
	const buffer = new Uint8Array(byteLength)
	crypto.getRandomValues(buffer)
	return base64url(buffer)
}

function generateShortCode(length = 6): string {
	const buffer = new Uint8Array(length)
	crypto.getRandomValues(buffer)
	let out = ''
	for (const byte of buffer) out += SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length]
	return out
}

/** SHA-256 hex digest of the input — used to store key/handoff tokens at rest. */
export async function hashToken(token: string): Promise<string> {
	const data = new TextEncoder().encode(token)
	const digest = await crypto.subtle.digest('SHA-256', data)
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
}

/**
 * Resolve a TTL request (preset or custom hours) to seconds, enforcing the
 * 12h cap. Returns null when the input is invalid.
 */
export function resolveTempopTtlSeconds(input: {
	ttlPreset?: string
	customHours?: number
}): number | null {
	const { ttlPreset, customHours } = input
	const hasPreset = ttlPreset !== undefined && ttlPreset !== null
	const hasCustom = customHours !== undefined && customHours !== null

	if (hasPreset === hasCustom) {
		// Exactly one of preset/custom must be provided.
		return null
	}

	if (hasPreset) {
		return TEMPOP_TTL_PRESETS[ttlPreset] ?? null
	}

	if (!Number.isFinite(customHours) || (customHours as number) <= 0) {
		return null
	}
	if ((customHours as number) > TEMPOP_MAX_CUSTOM_HOURS) {
		return null
	}
	return Math.round((customHours as number) * 60 * 60)
}

/**
 * Create a temp-op, generating a unique short code + URL token. The raw token
 * is returned once; only its SHA-256 hash is persisted.
 */
export async function createTempop(
	env: Env,
	params: { creatorUserId: string; ttlSeconds: number; groupName?: string }
): Promise<CreatedTempop> {
	const db = createDb(env.DATABASE_URL)
	const groupName = params.groupName ?? TEMPOP_GROUP_NAME
	const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000)

	let lastError: unknown
	for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
		const token = randomToken()
		const shortCode = generateShortCode()
		const keyHash = await hashToken(token)
		try {
			const [row] = await db
				.insert(mumbleTempops)
				.values({
					shortCode,
					keyHash,
					creatorUserId: params.creatorUserId,
					groupName,
					ttlSeconds: params.ttlSeconds,
					status: 'active',
					expiresAt,
				})
				.returning({ id: mumbleTempops.id, shortCode: mumbleTempops.shortCode })
			return { id: row.id, shortCode: row.shortCode, token, expiresAt }
		} catch (error) {
			// Retry on the rare shortCode/keyHash unique collision.
			lastError = error
		}
	}
	logger.error('[Mumble] Failed to create temp-op after retries', {
		error: lastError instanceof Error ? lastError.message : String(lastError),
	})
	throw new Error('Failed to create temp-op')
}

/**
 * Disconnect every active guest of a temp-op and mark the temp-op terminal.
 * `deleteMumbleAccounts` disconnects sessions, unregisters users, and queues
 * control-plane failures for durable alarm retry.
 */
async function finalizeTempop(
	env: Env,
	tempopId: string,
	terminalStatus: 'deleted' | 'expired'
): Promise<number> {
	const db = createDb(env.DATABASE_URL)

	const guests = await db.query.mumbleTempopGuests.findMany({
		where: and(
			eq(mumbleTempopGuests.tempopId, tempopId),
			eq(mumbleTempopGuests.status, 'active')
		),
		columns: { subjectId: true },
	})
	const subjectIds = guests.map((guest) => guest.subjectId)

	if (subjectIds.length > 0) {
		await deleteMumbleAccounts(env, subjectIds)
		await db
			.update(mumbleTempopGuests)
			.set({ status: 'deleted' })
			.where(eq(mumbleTempopGuests.tempopId, tempopId))
	}

	await db
		.update(mumbleTempops)
		.set({ status: terminalStatus, deletedAt: new Date() })
		.where(eq(mumbleTempops.id, tempopId))

	return subjectIds.length
}

/** Manually delete a temp-op, disconnecting all of its guests. */
export async function deleteTempop(
	env: Env,
	tempopId: string,
	actor: string
): Promise<{ disconnected: number }> {
	const disconnected = await finalizeTempop(env, tempopId, 'deleted')
	logger.info('[Mumble] Deleted temp-op', { tempopId, actor, disconnected })
	return { disconnected }
}

/**
 * Expire temp-ops whose TTL has elapsed and sweep stale credential handoffs.
 * Invoked from the core scheduled cron handler.
 */
export async function processExpiredTempops(
	env: Env
): Promise<{ expired: number; disconnected: number }> {
	const db = createDb(env.DATABASE_URL)
	const now = new Date()

	const expired = await db.query.mumbleTempops.findMany({
		where: and(eq(mumbleTempops.status, 'active'), lt(mumbleTempops.expiresAt, now)),
		columns: { id: true },
	})

	let disconnected = 0
	for (const tempop of expired) {
		try {
			disconnected += await finalizeTempop(env, tempop.id, 'expired')
		} catch (error) {
			logger.error('[Mumble] Failed to expire temp-op', {
				tempopId: tempop.id,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	await db
		.delete(mumbleTempopCredentialHandoffs)
		.where(lt(mumbleTempopCredentialHandoffs.expiresAt, now))

	if (expired.length > 0) {
		logger.info('[Mumble] Expired temp-ops', { expired: expired.length, disconnected })
	}

	return { expired: expired.length, disconnected }
}

/**
 * Store freshly provisioned guest credentials behind a single-use handoff
 * token (60s TTL). Returns the raw token to embed in the redirect.
 */
export async function storeCredentialHandoff(
	env: Env,
	tempopId: string,
	credentials: TempopCredentialPayload
): Promise<string> {
	const db = createDb(env.DATABASE_URL)
	const token = randomToken(24)
	const tokenHash = await hashToken(token)
	await db.insert(mumbleTempopCredentialHandoffs).values({
		tokenHash,
		tempopId,
		credentials,
		expiresAt: new Date(Date.now() + CREDENTIAL_HANDOFF_TTL_MS),
	})
	return token
}

/**
 * Exchange a handoff token for the stored credentials exactly once. The row is
 * always deleted on lookup; an expired row yields null.
 */
export async function consumeCredentialHandoff(
	env: Env,
	token: string
): Promise<TempopCredentialPayload | null> {
	const db = createDb(env.DATABASE_URL)
	const tokenHash = await hashToken(token)

	const row = await db.query.mumbleTempopCredentialHandoffs.findFirst({
		where: eq(mumbleTempopCredentialHandoffs.tokenHash, tokenHash),
	})
	if (!row) return null

	// Single-use: delete regardless of expiry.
	await db
		.delete(mumbleTempopCredentialHandoffs)
		.where(eq(mumbleTempopCredentialHandoffs.tokenHash, tokenHash))

	if (row.expiresAt.getTime() < Date.now()) return null
	return row.credentials
}
