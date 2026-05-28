export type PasteVisibility = 'alliance' | 'public'
export type PasteStatus = 'active'
export type PasteExpirationOption = number | 'indefinite'

export interface PasteRecord {
	id: string
	name: string
	createdByUserId: string
	createdByCharacterId: string | null
	createdByCharacterName: string | null
	visibility: PasteVisibility
	isPasswordProtected: boolean
	sizeBytes: number
	contentType: 'text/plain'
	expiresAt: string | null
	createdAt: string
	updatedAt: string
	lastAccessedAt: string | null
	encryptionVersion: string | null
}

export interface PasteSettings {
	createRateLimitCount: number
	createRateLimitWindowMinutes: number
	maxActivePastesPerUser: number
	updatedByUserId: string | null
	updatedAt: string
}

export interface CreatePasteInput {
	creatorUserId: string
	creatorCharacterId?: string | null
	creatorCharacterName?: string | null
	name: string
	content: string
	visibility: PasteVisibility
	expiration: PasteExpirationOption
	password?: string
}

export interface UpdatePasteInput {
	pasteId: string
	actorUserId: string
	name?: string
	content?: string
	visibility?: PasteVisibility
	expiration?: PasteExpirationOption
	isPasswordProtected?: boolean
	password?: string
}

export interface DeletePasteInput {
	pasteId: string
	actorUserId: string
	isAdmin?: boolean
}

export interface ListCreatorPastesInput {
	creatorUserId: string
	limit?: number
	offset?: number
}

export interface ListAdminPastesInput {
	limit?: number
	offset?: number
	visibility?: PasteVisibility
	creatorUserId?: string
	createdFrom?: string
	createdTo?: string
	expiresFrom?: string
	expiresTo?: string
}

export interface PasteViewerResponse {
	paste: PasteRecord
	content: string | null
	requiresPassword: boolean
}

export interface DecryptPasteInput {
	pasteId: string
	password: string
	requirePublic: boolean
	publicAttemptKey?: string
}

export interface PublicDecryptThrottleInput {
	attemptKey: string
}

export interface RotatePasswordInput {
	pasteId: string
	actorUserId: string
	currentPassword: string
	newPassword: string
}

export interface UpdatePasteSettingsInput {
	actorUserId: string
	createRateLimitCount: number
	createRateLimitWindowMinutes: number
	maxActivePastesPerUser: number
}

export interface PagedResult<T> {
	items: T[]
	total: number
}

export interface PasteWorker {
	createPaste(input: CreatePasteInput): Promise<PasteRecord>
	getPasteForAllianceViewer(pasteId: string): Promise<PasteViewerResponse | null>
	getPasteForPublicViewer(pasteId: string): Promise<PasteViewerResponse | null>
	decryptPaste(input: DecryptPasteInput): Promise<PasteViewerResponse | null>
	canAttemptPublicDecrypt(input: PublicDecryptThrottleInput): Promise<boolean>
	listCreatorPastes(input: ListCreatorPastesInput): Promise<PagedResult<PasteRecord>>
	listAdminPastes(input: ListAdminPastesInput): Promise<PagedResult<PasteRecord>>
	updatePaste(input: UpdatePasteInput): Promise<PasteRecord | null>
	rotatePastePassword(input: RotatePasswordInput): Promise<PasteRecord | null>
	deletePaste(input: DeletePasteInput): Promise<boolean>
	getPasteSettings(): Promise<PasteSettings>
	updatePasteSettings(input: UpdatePasteSettingsInput): Promise<PasteSettings>
	runExpirySweep(nowIso?: string): Promise<{ scanned: number; purged: number; failed: number }>
}
