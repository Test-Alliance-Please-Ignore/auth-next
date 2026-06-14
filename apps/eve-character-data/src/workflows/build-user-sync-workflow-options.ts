import type { EveCharacterSyncParams } from './sync-workflow'

export interface UserSyncBatch {
	userId: string
	characterIds: string[]
}

export function buildUserSyncWorkflowOptions(params: {
	userBatches: UserSyncBatch[]
	trigger: EveCharacterSyncParams['trigger']
	totalCount: number
	startIndex?: number
	jitterWindowSeconds?: number
}): Array<{ id: string; params: EveCharacterSyncParams }> {
	const totalCount = Math.max(0, Math.floor(params.totalCount))
	const startIndex = Math.max(0, Math.floor(params.startIndex ?? 0))
	const jitterWindowSeconds = Math.max(0, Math.floor(params.jitterWindowSeconds ?? 3600))
	const denominator = Math.max(totalCount - 1, 1)

	return params.userBatches.map((batch, index) => {
		const absoluteIndex = startIndex + index
		const jitterDelaySeconds =
			totalCount > 0 ? Math.floor((absoluteIndex / denominator) * jitterWindowSeconds) : 0

		return {
			id: `user-character-sync-${batch.userId}-${crypto.randomUUID()}`,
			params: {
				userId: batch.userId,
				characterIds: batch.characterIds,
				trigger: params.trigger,
				jitterDelaySeconds,
			},
		}
	})
}
