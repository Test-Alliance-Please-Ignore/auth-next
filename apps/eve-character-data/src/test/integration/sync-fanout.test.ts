import { describe, expect, it } from 'vitest'

import { buildCharacterSyncWorkflowOptions } from '../../workflows/build-character-sync-workflow-options'

describe('buildCharacterSyncWorkflowOptions', () => {
	it('groups characters by user and emits one workflow per user', async () => {
		const options = await buildCharacterSyncWorkflowOptions({
			characterIds: ['100', '101', '200'],
			resolveCharacterOwner: async (characterId) => {
				if (characterId === '100' || characterId === '101') {
					return { userId: 'user-a', isPrimary: characterId === '100' }
				}
				return { userId: 'user-b', isPrimary: true }
			},
			resolveUserCharacterIds: async (userId) => {
				if (userId === 'user-a') {
					return ['100', '101', '102']
				}
				return ['200', '201']
			},
			trigger: 'cron',
		})

		expect(options).toHaveLength(2)
		const userA = options.find((option) => option.params.userId === 'user-a')
		const userB = options.find((option) => option.params.userId === 'user-b')
		expect(userA?.params.characterIds).toEqual(['100', '101', '102'])
		expect(userB?.params.characterIds).toEqual(['200', '201'])
		expect(options.map((option) => option.params.jitterDelaySeconds)).toEqual([0, 3600])
	})

	it('falls back to standalone character workflows when owner is missing or lookup fails', async () => {
		const options = await buildCharacterSyncWorkflowOptions({
			characterIds: ['100', '999', '500'],
			resolveCharacterOwner: async (characterId) => {
				if (characterId === '100') return { userId: 'user-a', isPrimary: true }
				if (characterId === '999') return null
				throw new Error('owner lookup failed')
			},
			resolveUserCharacterIds: async (userId) => {
				if (userId === 'user-a') {
					throw new Error('character expansion failed')
				}
				return []
			},
			trigger: 'cron',
		})

		expect(options).toHaveLength(3)
		expect(options.filter((option) => option.params.userId === 'user-a')).toHaveLength(1)
		const standalone = options.filter((option) => !option.params.userId)
		expect(standalone).toHaveLength(2)
		expect(standalone.map((option) => option.params.characterId).sort()).toEqual(['500', '999'])
		expect(standalone.map((option) => option.params.jitterDelaySeconds)).toEqual([2400, 4800])
	})
})
