import type { PasteRecord, PasteSettings, PasteViewerResponse } from '@/lib/api'

export const paste: PasteRecord = {
	id: 'Original123',
	name: 'Original <paste> — 원문',
	createdByUserId: 'applicant-original',
	createdByCharacterId: '123456789',
	createdByCharacterName: 'Main <Pilot>',
	visibility: 'alliance',
	isPasswordProtected: false,
	sizeBytes: 1234,
	contentType: 'text/plain',
	expiresAt: '2026-09-15T10:00:00Z',
	createdAt: '2026-09-14T10:00:00Z',
	updatedAt: '2026-09-14T10:00:00Z',
	lastAccessedAt: null,
	encryptionVersion: null,
}
export const pasteContent = 'Original <script> content\n원문 bleibt unverändert'
export const pasteView: PasteViewerResponse = {
	paste,
	content: pasteContent,
	requiresPassword: false,
}
export const pasteSettings: PasteSettings = {
	createRateLimitCount: 10,
	createRateLimitWindowMinutes: 5,
	maxActivePastesPerUser: 50,
	updatedByUserId: null,
	updatedAt: paste.updatedAt,
}
export const myPastes = { items: [paste], total: 1, activeCount: 1, maxActivePastesPerUser: 50 }
