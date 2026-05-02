import { describe, expect, it } from 'vitest'

import { buildCharacterSyncWorkflowOptions } from '../../index'

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
			trigger: 'cron',
		})

		expect(options).toHaveLength(2)
		const userA = options.find((option) => option.params.userId === 'user-a')
		const userB = options.find((option) => option.params.userId === 'user-b')
		expect(userA?.params.characterIds).toEqual(['100', '101'])
		expect(userB?.params.characterIds).toEqual(['200'])
		expect(options.every((option) => option.params.jitterDelaySeconds !== undefined)).toBe(true)
	})

	it('falls back to standalone character workflows when owner is missing or lookup fails', async () => {
		const options = await buildCharacterSyncWorkflowOptions({
			characterIds: ['100', '999', '500'],
			resolveCharacterOwner: async (characterId) => {
				if (characterId === '100') return { userId: 'user-a', isPrimary: true }
				if (characterId === '999') return null
				throw new Error('owner lookup failed')
			},
			trigger: 'cron',
		})

		expect(options).toHaveLength(3)
		expect(options.filter((option) => option.params.userId === 'user-a')).toHaveLength(1)
		const standalone = options.filter((option) => !option.params.userId)
		expect(standalone).toHaveLength(2)
		expect(standalone.map((option) => option.params.characterId).sort()).toEqual(['500', '999'])
	})
})
