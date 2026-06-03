import { logger } from '@repo/hono-helpers'

import type { EveCharacterSyncParams } from './sync-workflow'

export async function buildCharacterSyncWorkflowOptions(params: {
	characterIds: string[]
	resolveCharacterOwner: (characterId: string) => Promise<{ userId: string; isPrimary: boolean } | null>
	resolveUserCharacterIds: (userId: string) => Promise<string[]>
	trigger: EveCharacterSyncParams['trigger']
}): Promise<Array<{ id: string; params: EveCharacterSyncParams }>> {
	const perUserCharacterIds = new Map<string, string[]>()
	const unownedCharacterIds: string[] = []
	for (const characterId of params.characterIds) {
		try {
			const owner = await params.resolveCharacterOwner(characterId)
			if (!owner?.userId) {
				unownedCharacterIds.push(characterId)
				continue
			}
			const bucket = perUserCharacterIds.get(owner.userId) ?? []
			bucket.push(characterId)
			perUserCharacterIds.set(owner.userId, bucket)
		} catch (error) {
			logger.warn('[EveCharacterData] Failed to resolve character owner; falling back to standalone sync', {
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			unownedCharacterIds.push(characterId)
		}
	}

	const perUserEntries = await Promise.all(
		[...perUserCharacterIds.entries()].map(async ([userId, dueCharacterIds]) => {
			try {
				const allUserCharacterIds = await params.resolveUserCharacterIds(userId)
				const expandedCharacterIds = Array.from(
					new Set(allUserCharacterIds.length > 0 ? allUserCharacterIds : dueCharacterIds)
				)
				return { userId, characterIds: expandedCharacterIds }
			} catch (error) {
				logger.warn('[EveCharacterData] Failed to resolve user character IDs; using due characters only', {
					userId,
					error: error instanceof Error ? error.message : String(error),
				})
				return { userId, characterIds: dueCharacterIds }
			}
		})
	)

	const total = perUserEntries.length + unownedCharacterIds.length
	const JITTER_WINDOW_SECONDS = 7200

	return [
		...perUserEntries.map(({ userId, characterIds: userCharacterIds }) => ({
			id: `user-character-sync-${userId}-${crypto.randomUUID()}`,
			params: {
				userId,
				characterIds: userCharacterIds,
				trigger: params.trigger,
				jitterDelaySeconds: 0,
			},
		})),
		...unownedCharacterIds.map((characterId) => ({
			id: `character-sync-${characterId}-${crypto.randomUUID()}`,
			params: {
				characterIds: [characterId],
				characterId,
				trigger: params.trigger,
				jitterDelaySeconds: 0,
			},
		})),
	].map((workflow, index) => ({
		...workflow,
		params: {
			...workflow.params,
			jitterDelaySeconds: total > 0 ? Math.floor((index / total) * JITTER_WINDOW_SECONDS) : 0,
		},
	}))
}
