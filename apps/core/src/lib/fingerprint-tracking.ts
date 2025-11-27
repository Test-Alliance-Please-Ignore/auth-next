import { and, eq } from '@repo/db-utils'

import { userFingerprints } from '../db/schema'

import type { createDb } from '../db'

const MIN_UPDATE_INTERVAL_MS = 15 * 60 * 1000 // 15 minutes

export interface RecordFingerprintOptions {
	db: ReturnType<typeof createDb>
	userId: string
	fingerprint: string
	now?: Date
}

export async function recordUserFingerprint({
	db,
	userId,
	fingerprint,
	now = new Date(),
}: RecordFingerprintOptions): Promise<void> {
	if (!fingerprint) return

	const fp = fingerprint.trim()
	if (!fp) return

	const existing = await db.query.userFingerprints.findFirst({
		where: and(eq(userFingerprints.userId, userId), eq(userFingerprints.fingerprint, fp)),
	})

	if (!existing) {
		await db.insert(userFingerprints).values({
			userId,
			fingerprint: fp,
			firstSeenAt: now,
			lastSeenAt: now,
		})
		return
	}

	const lastSeenAt = existing.lastSeenAt ?? existing.firstSeenAt
	if (lastSeenAt && now.getTime() - lastSeenAt.getTime() < MIN_UPDATE_INTERVAL_MS) {
		return // Throttled
	}

	await db
		.update(userFingerprints)
		.set({ lastSeenAt: now })
		.where(eq(userFingerprints.id, existing.id))
}
