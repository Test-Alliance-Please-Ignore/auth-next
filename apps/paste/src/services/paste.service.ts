import { and, desc, eq, gte, isNull, lte, or, sql } from '@repo/db-utils'
import {
	type CreatePasteInput,
	type DecryptPasteInput,
	type DeletePasteInput,
	type ListAdminPastesInput,
	type ListCreatorPastesInput,
	type PasteRecord,
	type PasteSettings,
	type PasteVisibility,
	type PagedResult,
	type RotatePasswordInput,
	type UpdatePasteInput,
	type UpdatePasteSettingsInput,
} from '@repo/paste'
import { runExpirySweep } from '@repo/worker-utils'

import { createDb, schema } from '../db'

import type { DbClient } from '@repo/db-utils'
import type { PasteRow, PasteSettingsRow } from '../db/schema'

const MAX_PASTE_BYTES = 1_048_576
const ENCRYPTION_VERSION = 'v1'
const KDF_NAME = 'PBKDF2-SHA256'
const CIPHER_NAME = 'AES-256-GCM'
const KDF_ITERATIONS = 120_000
const ID_LENGTH = 10
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const PASSWORD_PATTERN =
	/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*_\-+=,.?/|~`:])[A-Za-z0-9!@#$%^&*_\-+=,.?/|~`:]{8,128}$/
const PUBLIC_DECRYPT_MAX_ATTEMPTS = 5
const PUBLIC_DECRYPT_WINDOW_MS = 5 * 60_000
const ALLOWED_EXPIRATION_PRESETS: ReadonlyArray<number | 'indefinite'> = [
	60,
	180,
	360,
	720,
	1440,
	4320,
	10080,
	20160,
	43200,
	'indefinite',
]

type Envelope = {
	kdf: string
	kdfIterations: number
	kdfSalt: string
	cipher: string
	cipherIv: string
	encryptionVersion: string
}

function toPasteRecord(row: PasteRow): PasteRecord {
	return {
		id: row.id,
		name: row.name,
		createdByUserId: row.createdByUserId,
		createdByCharacterId: row.createdByCharacterId,
		createdByCharacterName: row.createdByCharacterName,
		visibility: row.visibility as PasteVisibility,
		isPasswordProtected: row.isPasswordProtected === 1,
		sizeBytes: row.sizeBytes,
		contentType: row.contentType as 'text/plain',
		expiresAt: row.expiresAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
		encryptionVersion: row.encryptionVersion,
	}
}

function assertPassword(password: string): void {
	if (!PASSWORD_PATTERN.test(password)) {
		throw new Error(
			'Password must be at least 8 chars, include lower/upper/digit, include at least one symbol, and only use symbols: ! @ # $ % ^ & * - _ = + , . ? / | ~ ` :'
		)
	}
}

function assertPlaintext(content: string): void {
	const bytes = new TextEncoder().encode(content)
	if (bytes.byteLength > MAX_PASTE_BYTES) {
		throw new Error('Paste exceeds 1 MiB size limit')
	}
	// Accept TAB/LF/CR and printable ASCII only to avoid binary/control payloads.
	for (let i = 0; i < content.length; i += 1) {
		const code = content.charCodeAt(i)
		const isPrintableAscii = code >= 0x20 && code <= 0x7e
		const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d
		if (!isPrintableAscii && !isAllowedWhitespace) {
			throw new Error('Paste content must be plain text only')
		}
	}
}

function randomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
	let value = ''
	for (const byte of bytes) {
		value += BASE62[byte % BASE62.length]
	}
	return value
}

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer)
	let binary = ''
	for (const b of bytes) binary += String.fromCharCode(b)
	return btoa(binary)
}

function fromBase64(value: string): ArrayBuffer {
	const binary = atob(value)
	const out = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
	return out.buffer
}

function buildR2Key(id: string): string {
	const now = new Date()
	const year = now.getUTCFullYear()
	const month = String(now.getUTCMonth() + 1).padStart(2, '0')
	return `pastes/${year}/${month}/${id}.txt`
}

function isIndefinite(value: number | 'indefinite'): boolean {
	return value === 'indefinite'
}

function validateExpirationOption(
	input: number | 'indefinite'
): Date | null {
	if (isIndefinite(input)) {
		return null
	}
	if (!ALLOWED_EXPIRATION_PRESETS.includes(input)) {
		throw new Error('Invalid expiration option')
	}
	if (typeof input !== 'number') {
		throw new Error('Invalid expiration option')
	}
	return new Date(Date.now() + input * 60_000)
}

async function encryptContent(password: string, plaintext: string): Promise<{ content: string; envelope: Envelope }> {
	const salt = crypto.getRandomValues(new Uint8Array(16))
	const iv = crypto.getRandomValues(new Uint8Array(12))
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	)
	const key = await crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt,
			iterations: KDF_ITERATIONS,
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt']
	)
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		new TextEncoder().encode(plaintext)
	)
	return {
		content: toBase64(encrypted),
		envelope: {
			kdf: KDF_NAME,
			kdfIterations: KDF_ITERATIONS,
			kdfSalt: toBase64(salt.buffer),
			cipher: CIPHER_NAME,
			cipherIv: toBase64(iv.buffer),
			encryptionVersion: ENCRYPTION_VERSION,
		},
	}
}

async function decryptContent(password: string, ciphertextBase64: string, row: PasteRow): Promise<string> {
	if (!row.kdfSalt || !row.cipherIv || !row.kdfIterations) {
		throw new Error('Paste is missing encryption metadata')
	}
	const salt = fromBase64(row.kdfSalt)
	const iv = fromBase64(row.cipherIv)
	const ciphertext = fromBase64(ciphertextBase64)
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveKey']
	)
	const key = await crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt,
			iterations: row.kdfIterations,
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['decrypt']
	)
	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv },
		key,
		ciphertext
	)
	return new TextDecoder().decode(decrypted)
}

export class PasteService {
	constructor(
		private readonly db: DbClient<typeof schema>,
		private readonly bucket: R2Bucket,
		private readonly throttleKv: KVNamespace
	) {}

	static fromEnv(databaseUrl: string, bucket: R2Bucket, throttleKv: KVNamespace): PasteService {
		return new PasteService(createDb(databaseUrl), bucket, throttleKv)
	}

	private async getOrCreateSettings(): Promise<PasteSettingsRow> {
		const existing = await this.db.query.pasteSettings.findFirst({
			where: eq(schema.pasteSettings.id, 'default'),
		})
		if (existing) return existing
		const [created] = await this.db
			.insert(schema.pasteSettings)
			.values({ id: 'default' })
			.returning()
		return created
	}

	private mapSettings(settings: PasteSettingsRow): PasteSettings {
		return {
			createRateLimitCount: settings.createRateLimitCount,
			createRateLimitWindowMinutes: settings.createRateLimitWindowMinutes,
			maxActivePastesPerUser: settings.maxActivePastesPerUser,
			updatedByUserId: settings.updatedByUserId,
			updatedAt: settings.updatedAt.toISOString(),
		}
	}

	private async assertCreateLimits(userId: string, settings: PasteSettingsRow): Promise<void> {
		const now = new Date()
		const windowStart = new Date(now.getTime() - settings.createRateLimitWindowMinutes * 60_000)
		const [recentRows] = await this.db
			.select({ total: sql<number>`count(*)` })
			.from(schema.pastes)
			.where(and(eq(schema.pastes.createdByUserId, userId), gte(schema.pastes.createdAt, windowStart)))

		if (recentRows.total >= settings.createRateLimitCount) {
			throw new Error('Rate limit exceeded for paste creation')
		}

		const [activeRows] = await this.db
			.select({ total: sql<number>`count(*)` })
			.from(schema.pastes)
			.where(
				and(
					eq(schema.pastes.createdByUserId, userId),
					or(isNull(schema.pastes.expiresAt), gte(schema.pastes.expiresAt, now))
				)
			)

		if (activeRows.total >= settings.maxActivePastesPerUser) {
			throw new Error('Maximum active pastes reached')
		}
	}

	private async getByIdActive(pasteId: string): Promise<PasteRow | null> {
		const row = await this.db.query.pastes.findFirst({
			where: eq(schema.pastes.id, pasteId),
		})
		if (!row) return null
		if (row.expiresAt && row.expiresAt <= new Date()) {
			return null
		}
		return row
	}

	async createPaste(input: CreatePasteInput): Promise<PasteRecord> {
		if (!input.name.trim()) {
			throw new Error('Paste name is required')
		}
		assertPlaintext(input.content)
		const settings = await this.getOrCreateSettings()
		const expiresAt = validateExpirationOption(input.expiration)
		await this.assertCreateLimits(input.creatorUserId, settings)

		const visibility = input.visibility
		const needsPassword = visibility === 'public' || Boolean(input.password)
		if (visibility === 'public' && !input.password) {
			throw new Error('Public pastes require password protection')
		}

		if (input.password) assertPassword(input.password)

		let attempts = 0
		let created: PasteRow | null = null
		while (!created && attempts < 5) {
			attempts += 1
			const id = randomId()
			const r2Key = buildR2Key(id)
			let storedContent = input.content
			let envelope: Envelope | null = null

			if (needsPassword) {
				if (!input.password) throw new Error('Password is required')
				const encrypted = await encryptContent(input.password, input.content)
				storedContent = encrypted.content
				envelope = encrypted.envelope
			}

			await this.bucket.put(r2Key, storedContent, {
				httpMetadata: { contentType: 'text/plain' },
			})

			try {
				const [row] = await this.db
					.insert(schema.pastes)
					.values({
						id,
						name: input.name.trim(),
						createdByUserId: input.creatorUserId,
						createdByCharacterId: input.creatorCharacterId ?? null,
						createdByCharacterName: input.creatorCharacterName ?? null,
						visibility,
						isPasswordProtected: needsPassword ? 1 : 0,
						encryptionVersion: envelope?.encryptionVersion ?? null,
						kdf: envelope?.kdf ?? null,
						kdfIterations: envelope?.kdfIterations ?? null,
						kdfSalt: envelope?.kdfSalt ?? null,
						cipher: envelope?.cipher ?? null,
						cipherIv: envelope?.cipherIv ?? null,
						r2Bucket: 'PASTE_BUCKET',
						r2Key,
						sizeBytes: new TextEncoder().encode(input.content).byteLength,
						contentType: 'text/plain',
						expiresAt,
					})
					.returning()
				created = row
			} catch (error) {
				await this.bucket.delete(r2Key)
				const message = error instanceof Error ? error.message : String(error)
				if (!message.toLowerCase().includes('duplicate')) throw error
			}
		}

		if (!created) {
			throw new Error('Failed to generate unique paste ID')
		}

		return toPasteRecord(created)
	}

	private async getViewerResponse(row: PasteRow): Promise<{
		paste: PasteRecord
		content: string | null
		requiresPassword: boolean
	} | null> {
		const isProtected = row.isPasswordProtected === 1
		let content: string | null = null
		if (!isProtected) {
			content = await this.fetchPlaintext(row.r2Key)
			if (content === null) {
				return null
			}
		}
		return {
			paste: toPasteRecord(row),
			content,
			requiresPassword: isProtected,
		}
	}

	private async fetchPlaintext(r2Key: string): Promise<string | null> {
		const object = await this.bucket.get(r2Key)
		if (!object) return null
		return object.text()
	}

	async getPasteForAllianceViewer(pasteId: string) {
		const row = await this.getByIdActive(pasteId)
		if (!row) return null
		await this.db
			.update(schema.pastes)
			.set({ lastAccessedAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.pastes.id, pasteId))
		return this.getViewerResponse(row)
	}

	async getPasteForPublicViewer(pasteId: string) {
		const row = await this.getByIdActive(pasteId)
		if (!row || row.visibility !== 'public') return null
		await this.db
			.update(schema.pastes)
			.set({ lastAccessedAt: new Date(), updatedAt: new Date() })
			.where(eq(schema.pastes.id, pasteId))
		return this.getViewerResponse(row)
	}

	async decryptPaste(input: DecryptPasteInput) {
		const row = await this.getByIdActive(input.pasteId)
		if (!row) return null
		if (input.requirePublic && row.visibility !== 'public') return null
		if (input.requirePublic) {
			const attemptKey = input.publicAttemptKey?.trim()
			if (!attemptKey) return null
			const allowed = await this.canAttemptPublicDecrypt({ attemptKey })
			if (!allowed) return null
		}
		if (row.isPasswordProtected !== 1) return this.getViewerResponse(row)
		const ciphertext = await this.fetchPlaintext(row.r2Key)
		if (!ciphertext) return null
		let content: string
		try {
			content = await decryptContent(input.password, ciphertext, row)
		} catch {
			if (input.requirePublic && input.publicAttemptKey) {
				await this.markPublicDecryptFailure(input.publicAttemptKey)
			}
			return null
		}
		if (input.requirePublic && input.publicAttemptKey) {
			await this.clearPublicDecryptFailures(input.publicAttemptKey)
		}
		return { paste: toPasteRecord(row), content, requiresPassword: false }
	}

	async canAttemptPublicDecrypt(input: { attemptKey: string }): Promise<boolean> {
		if (!this.throttleKv) return true
		const record = await this.throttleKv.get<{ failedCount: number }>(`public-decrypt:${input.attemptKey}`, 'json')
		if (!record) return true
		return record.failedCount < PUBLIC_DECRYPT_MAX_ATTEMPTS
	}

	private async markPublicDecryptFailure(attemptKey: string): Promise<void> {
		if (!this.throttleKv) return
		const key = `public-decrypt:${attemptKey}`
		const record = await this.throttleKv.get<{ failedCount: number }>(key, 'json')
		const failedCount = (record?.failedCount ?? 0) + 1
		await this.throttleKv.put(
			key,
			JSON.stringify({ failedCount }),
			{ expirationTtl: Math.ceil(PUBLIC_DECRYPT_WINDOW_MS / 1000) }
		)
	}

	private async clearPublicDecryptFailures(attemptKey: string): Promise<void> {
		if (!this.throttleKv) return
		await this.throttleKv.delete(`public-decrypt:${attemptKey}`)
	}

	async listCreatorPastes(input: ListCreatorPastesInput): Promise<PagedResult<PasteRecord>> {
		const limit = Math.max(1, Math.min(200, input.limit ?? 50))
		const offset = Math.max(0, input.offset ?? 0)
		const now = new Date()
		const settings = await this.getOrCreateSettings()
		const activeWhere = and(
			eq(schema.pastes.createdByUserId, input.creatorUserId),
			or(isNull(schema.pastes.expiresAt), gte(schema.pastes.expiresAt, now))
		)
		const [rows, [{ total }]] = await Promise.all([
			this.db.query.pastes.findMany({
				where: activeWhere,
				orderBy: [desc(schema.pastes.createdAt)],
				limit,
				offset,
			}),
			this.db
				.select({ total: sql<number>`count(*)` })
				.from(schema.pastes)
				.where(activeWhere),
		])
		const activeCount = Number(total)
		return {
			items: rows.map(toPasteRecord),
			total: Number(total),
			activeCount,
			maxActivePastesPerUser: settings.maxActivePastesPerUser,
		}
	}

	async listAdminPastes(input: ListAdminPastesInput): Promise<PagedResult<PasteRecord>> {
		const limit = Math.max(1, Math.min(200, input.limit ?? 50))
		const offset = Math.max(0, input.offset ?? 0)
		const conditions = []
		if (input.visibility) conditions.push(eq(schema.pastes.visibility, input.visibility))
		if (input.creatorUserId) conditions.push(eq(schema.pastes.createdByUserId, input.creatorUserId))
		if (input.createdFrom) conditions.push(gte(schema.pastes.createdAt, new Date(input.createdFrom)))
		if (input.createdTo) conditions.push(lte(schema.pastes.createdAt, new Date(input.createdTo)))
		if (input.expiresFrom) conditions.push(gte(schema.pastes.expiresAt, new Date(input.expiresFrom)))
		if (input.expiresTo) conditions.push(lte(schema.pastes.expiresAt, new Date(input.expiresTo)))
		const where = conditions.length > 1 ? and(...conditions) : conditions[0]

		const [rows, [{ total }]] = await Promise.all([
			this.db.query.pastes.findMany({
				where,
				orderBy: [desc(schema.pastes.createdAt)],
				limit,
				offset,
			}),
			this.db.select({ total: sql<number>`count(*)` }).from(schema.pastes).where(where),
		])
		return { items: rows.map(toPasteRecord), total }
	}

	async updatePaste(input: UpdatePasteInput): Promise<PasteRecord | null> {
		const row = await this.db.query.pastes.findFirst({
			where: and(eq(schema.pastes.id, input.pasteId), eq(schema.pastes.createdByUserId, input.actorUserId)),
		})
		if (!row) return null
		const settings = await this.getOrCreateSettings()
		const updates: Partial<typeof schema.pastes.$inferInsert> = { updatedAt: new Date() }
		if (input.name !== undefined) {
			const trimmedName = input.name.trim()
			if (!trimmedName) {
				throw new Error('Paste name is required')
			}
			updates.name = trimmedName
		}
		if (input.expiration !== undefined) {
			updates.expiresAt = validateExpirationOption(input.expiration)
		}
		if (input.visibility) {
			updates.visibility = input.visibility
		}

		if (input.content !== undefined || input.isPasswordProtected !== undefined || input.password !== undefined) {
			const nextVisibility = (input.visibility ?? row.visibility) as PasteVisibility
			const nextProtected = input.isPasswordProtected ?? row.isPasswordProtected === 1

			if (nextVisibility === 'public' && !nextProtected) {
				throw new Error('Public pastes require password protection')
			}
			if (nextProtected && !input.password) {
				throw new Error('Password is required for password-protected pastes')
			}

			let nextContent = input.content
			if (nextContent === undefined) {
				// If caller did not provide replacement content, carry forward existing content.
				const existing = await this.fetchPlaintext(row.r2Key)
				if (!existing) throw new Error('Paste content is unavailable')
				if (row.isPasswordProtected === 1) {
					throw new Error('Content must be provided when updating a protected paste')
				}
				nextContent = existing
			}
			assertPlaintext(nextContent)

			if (nextProtected) {
				assertPassword(input.password as string)
				const encrypted = await encryptContent(input.password as string, nextContent)
				await this.bucket.put(row.r2Key, encrypted.content, {
					httpMetadata: { contentType: 'text/plain' },
				})
				updates.isPasswordProtected = 1
				updates.encryptionVersion = encrypted.envelope.encryptionVersion
				updates.kdf = encrypted.envelope.kdf
				updates.kdfIterations = encrypted.envelope.kdfIterations
				updates.kdfSalt = encrypted.envelope.kdfSalt
				updates.cipher = encrypted.envelope.cipher
				updates.cipherIv = encrypted.envelope.cipherIv
			} else {
				await this.bucket.put(row.r2Key, nextContent, {
					httpMetadata: { contentType: 'text/plain' },
				})
				updates.isPasswordProtected = 0
				updates.encryptionVersion = null
				updates.kdf = null
				updates.kdfIterations = null
				updates.kdfSalt = null
				updates.cipher = null
				updates.cipherIv = null
			}

			updates.sizeBytes = new TextEncoder().encode(nextContent).byteLength
		}

		const [updated] = await this.db
			.update(schema.pastes)
			.set(updates)
			.where(eq(schema.pastes.id, input.pasteId))
			.returning()
		return updated ? toPasteRecord(updated) : null
	}

	async rotatePastePassword(input: RotatePasswordInput): Promise<PasteRecord | null> {
		assertPassword(input.currentPassword)
		assertPassword(input.newPassword)
		const row = await this.db.query.pastes.findFirst({
			where: and(eq(schema.pastes.id, input.pasteId), eq(schema.pastes.createdByUserId, input.actorUserId)),
		})
		if (!row) return null
		if (row.isPasswordProtected !== 1) {
			throw new Error('Paste is not password-protected')
		}
		const ciphertext = await this.fetchPlaintext(row.r2Key)
		if (!ciphertext) {
			throw new Error('Paste content is unavailable')
		}
		let plaintext: string
		try {
			plaintext = await decryptContent(input.currentPassword, ciphertext, row)
		} catch {
			throw new Error('Current password is invalid')
		}
		const encrypted = await encryptContent(input.newPassword, plaintext)
		await this.bucket.put(row.r2Key, encrypted.content, {
			httpMetadata: { contentType: 'text/plain' },
		})
		const [updated] = await this.db
			.update(schema.pastes)
			.set({
				encryptionVersion: encrypted.envelope.encryptionVersion,
				kdf: encrypted.envelope.kdf,
				kdfIterations: encrypted.envelope.kdfIterations,
				kdfSalt: encrypted.envelope.kdfSalt,
				cipher: encrypted.envelope.cipher,
				cipherIv: encrypted.envelope.cipherIv,
				updatedAt: new Date(),
			})
			.where(eq(schema.pastes.id, row.id))
			.returning()
		return updated ? toPasteRecord(updated) : null
	}

	async deletePaste(input: DeletePasteInput): Promise<boolean> {
		const row = await this.db.query.pastes.findFirst({
			where: eq(schema.pastes.id, input.pasteId),
		})
		if (!row) return false
		const isOwner = row.createdByUserId === input.actorUserId
		if (!isOwner && !input.isAdmin) return false
		await this.bucket.delete(row.r2Key)
		await this.db.delete(schema.pastes).where(eq(schema.pastes.id, input.pasteId))
		return true
	}

	async getPasteSettings(): Promise<PasteSettings> {
		const settings = await this.getOrCreateSettings()
		return this.mapSettings(settings)
	}

	async updatePasteSettings(input: UpdatePasteSettingsInput): Promise<PasteSettings> {
		if (input.createRateLimitCount < 1 || input.createRateLimitWindowMinutes < 1) {
			throw new Error('Rate limit settings must be positive')
		}
		if (input.maxActivePastesPerUser < 1) {
			throw new Error('maxActivePastesPerUser must be positive')
		}
		const [updated] = await this.db
			.insert(schema.pasteSettings)
			.values({
				id: 'default',
				createRateLimitCount: input.createRateLimitCount,
				createRateLimitWindowMinutes: input.createRateLimitWindowMinutes,
				maxActivePastesPerUser: input.maxActivePastesPerUser,
				updatedByUserId: input.actorUserId,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: schema.pasteSettings.id,
				set: {
					createRateLimitCount: input.createRateLimitCount,
					createRateLimitWindowMinutes: input.createRateLimitWindowMinutes,
					maxActivePastesPerUser: input.maxActivePastesPerUser,
					updatedByUserId: input.actorUserId,
					updatedAt: new Date(),
				},
			})
			.returning()
		return this.mapSettings(updated)
	}

	async runExpirySweep(nowIso?: string): Promise<{ scanned: number; purged: number; failed: number }> {
		const now = nowIso ? new Date(nowIso) : new Date()
		const expired = await this.db.query.pastes.findMany({
			where: and(lte(schema.pastes.expiresAt, now)),
			limit: 500,
			orderBy: [desc(schema.pastes.expiresAt)],
		})
		return runExpirySweep({
			items: expired.map((row) => ({ ...row, expiresAt: row.expiresAt })),
			now,
			onHardDelete: async (item) => {
				await this.bucket.delete(item.r2Key)
				await this.db.delete(schema.pastes).where(eq(schema.pastes.id, item.id))
			},
		})
	}
}
