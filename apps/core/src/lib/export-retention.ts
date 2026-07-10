import { parseDateOrNull, runExpirySweep } from '@repo/worker-utils'

export const EXPORT_ARTIFACT_TTL_MS = 60 * 1000
export const EXPORT_ARTIFACT_METADATA_EXPIRY_KEY = 'expiresAt'

export function getExportArtifactExpiresAt(now = new Date()): Date {
	return new Date(now.getTime() + EXPORT_ARTIFACT_TTL_MS)
}

export function getExportArtifactExpiresAtIso(now = new Date()): string {
	return getExportArtifactExpiresAt(now).toISOString()
}

export function isExportArtifactExpired(
	expiresAtRaw: string | null | undefined,
	now = new Date()
): boolean {
	const expiresAt = parseDateOrNull(expiresAtRaw ?? undefined)
	return expiresAt !== null && expiresAt <= now
}

export async function cleanupExpiredExportArtifacts(
	bucket: R2Bucket,
	prefix: string,
	now = new Date()
): Promise<{ scanned: number; purged: number; failed: number }> {
	let cursor: string | undefined
	let scanned = 0
	let purged = 0
	let failed = 0

	do {
		const listed = await bucket.list({
			prefix,
			cursor,
			limit: 1000,
		})

		const result = await runExpirySweep({
			items: listed.objects.map((object) => ({
				id: object.key,
				expiresAt: parseDateOrNull(object.customMetadata?.[EXPORT_ARTIFACT_METADATA_EXPIRY_KEY]),
			})),
			now,
			onHardDelete: async (item) => {
				await bucket.delete(item.id)
			},
		})

		scanned += result.scanned
		purged += result.purged
		failed += result.failed
		cursor = listed.truncated ? listed.cursor : undefined
	} while (cursor)

	return { scanned, purged, failed }
}
