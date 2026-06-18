/**
 * Zod schemas for the murmur-control REST contract.
 *
 * These mirror the machine-readable contract in the murmur-control repo
 * (openapi.json / INTEGRATION_CONTRACT.md). The mumble worker uses them to
 * validate responses; core can share the inferred types via @repo/mumble.
 */
import { z } from 'zod'

/**
 * Decode standard base64 to a byte length, returning null for invalid input.
 */
function base64ByteLength(value: string): number | null {
	try {
		return atob(value).length
	} catch {
		return null
	}
}

/**
 * Imported PBKDF2-SHA256 verifier material.
 * hash: base64, must decode to exactly 32 bytes.
 * salt: base64, must decode to at least 16 bytes.
 * iterations: at least 200000.
 */
export type PasswordVerifier = z.infer<typeof PasswordVerifierSchema>
export const PasswordVerifierSchema = z.object({
	algorithm: z.literal('pbkdf2-sha256'),
	hash: z.string().refine((value) => base64ByteLength(value) === 32, {
		error: 'hash must be standard base64 decoding to exactly 32 bytes',
	}),
	salt: z.string().refine((value) => (base64ByteLength(value) ?? 0) >= 16, {
		error: 'salt must be standard base64 decoding to at least 16 bytes',
	}),
	iterations: z.number().int().min(200_000),
})

/**
 * Upstream-synced local account intent for local-accounts:batchSync.
 * loginName uniqueness is case-insensitive within a server.
 */
export type SyncedLocalAccount = z.infer<typeof SyncedLocalAccountSchema>
export const SyncedLocalAccountSchema = z.object({
	subjectId: z.string().min(1),
	loginName: z.string().min(1),
	displayName: z.string().min(1),
	enabled: z.boolean(),
	groups: z.array(z.string()),
	comment: z.string().optional(),
	passwordVerifier: PasswordVerifierSchema.optional(),
})

export type BatchSyncLocalAccountsRequest = z.infer<typeof BatchSyncLocalAccountsRequestSchema>
export const BatchSyncLocalAccountsRequestSchema = z.object({
	accounts: z.array(SyncedLocalAccountSchema),
})

/**
 * Local voice account state as returned by murmur-control reads.
 */
export type LocalAccountSnapshot = z.infer<typeof LocalAccountSnapshotSchema>
export const LocalAccountSnapshotSchema = z.object({
	subjectId: z.string(),
	loginName: z.string(),
	displayName: z.string(),
	enabled: z.boolean(),
	groups: z.array(z.string()),
	comment: z.string().nullable(),
	hasPassword: z.boolean(),
	lastCertificateHash: z.string().nullable(),
	lastAuthenticatedAt: z.string().nullable(),
	lastClientRelease: z.string().nullable(),
	lastClientVersion: z.number().int().nullable(),
})

export type LocalAccountResponse = z.infer<typeof LocalAccountResponseSchema>
export const LocalAccountResponseSchema = z.object({
	serverId: z.string(),
	account: LocalAccountSnapshotSchema,
})

export type BatchSyncLocalAccountsResponse = z.infer<typeof BatchSyncLocalAccountsResponseSchema>
export const BatchSyncLocalAccountsResponseSchema = z.object({
	serverId: z.string(),
	updated: z.array(LocalAccountSnapshotSchema),
})

export type LocalAccountGroupAssignment = z.infer<typeof LocalAccountGroupAssignmentSchema>
export const LocalAccountGroupAssignmentSchema = z.object({
	subjectId: z.string().min(1),
	groups: z.array(z.string()),
})

export type BatchAssignLocalAccountGroupsRequest = z.infer<
	typeof BatchAssignLocalAccountGroupsRequestSchema
>
export const BatchAssignLocalAccountGroupsRequestSchema = z.object({
	assignments: z.array(LocalAccountGroupAssignmentSchema),
	reason: z.string().optional(),
})

export type SubjectIdsRequest = z.infer<typeof SubjectIdsRequestSchema>
export const SubjectIdsRequestSchema = z.object({
	subjectIds: z.array(z.string().min(1)),
})

export type BatchAssignLocalAccountGroupsResponse = z.infer<
	typeof BatchAssignLocalAccountGroupsResponseSchema
>
export const BatchAssignLocalAccountGroupsResponseSchema = z.object({
	serverId: z.string(),
	disconnectedSessions: z.number().int(),
	updated: z.array(LocalAccountSnapshotSchema),
})

export type BatchEnableLocalAccountsResponse = z.infer<
	typeof BatchEnableLocalAccountsResponseSchema
>
export const BatchEnableLocalAccountsResponseSchema = z.object({
	serverId: z.string(),
	updated: z.array(LocalAccountSnapshotSchema),
})

export type BatchDisableLocalAccountsResponse = z.infer<
	typeof BatchDisableLocalAccountsResponseSchema
>
export const BatchDisableLocalAccountsResponseSchema = z.object({
	serverId: z.string(),
	disconnectedSessions: z.number().int(),
	updated: z.array(LocalAccountSnapshotSchema),
})

export type BatchDeleteLocalAccountsResponse = z.infer<
	typeof BatchDeleteLocalAccountsResponseSchema
>
export const BatchDeleteLocalAccountsResponseSchema = z.object({
	serverId: z.string(),
	deletedSubjectIds: z.array(z.string()),
	disconnectedSessions: z.number().int(),
})

/**
 * Projected Murmur registered-user state (GET /state/users).
 */
export type UserProjectionSnapshot = z.infer<typeof UserProjectionSnapshotSchema>
export const UserProjectionSnapshotSchema = z.object({
	subjectId: z.string(),
	loginName: z.string(),
	displayName: z.string(),
	enabled: z.boolean(),
	groups: z.array(z.string()),
	murmurUserId: z.number().int().nullable(),
	status: z.enum(['queued', 'reconciled']),
	comment: z.string().nullable(),
	lastCertificateHash: z.string().nullable(),
	lastAuthenticatedAt: z.string().nullable(),
	lastClientRelease: z.string().nullable(),
	lastClientVersion: z.number().int().nullable(),
})

export type UserProjectionStateResponse = z.infer<typeof UserProjectionStateResponseSchema>
export const UserProjectionStateResponseSchema = z.object({
	serverId: z.string(),
	users: z.array(UserProjectionSnapshotSchema),
})

/**
 * murmur-control error envelope.
 */
export type MurmurControlErrorResponse = z.infer<typeof MurmurControlErrorResponseSchema>
export const MurmurControlErrorResponseSchema = z.object({
	error: z.string(),
	details: z.unknown().nullable().optional(),
})
