import { describe, expect, it } from 'vitest'

import {
	buildTokenInvalidationMessage,
	didTokenTransitionFromValidToInvalid,
} from '../lib/token-invalid-alerts'

describe('token invalid alerts message builder', () => {
	it('summarizes character names and truncates long lists', () => {
		const message = buildTokenInvalidationMessage({
			characterNames: [
				'Alpha One',
				'Beta Two',
				'Gamma Three',
				'Delta Four',
				'Epsilon Five',
				'Zeta Six',
				'Eta Seven',
				'Theta Eight',
				'Iota Nine',
			],
			invalidCharacterCount: 9,
			updatedAt: new Date('2026-06-16T12:00:00.000Z'),
		})

		expect(message.content).toBe('')
		expect(message.embeds?.[0]).toMatchObject({
			title: '9 of your character tokens are invalid',
			footer: { text: 'Token invalidation notice' },
			timestamp: '2026-06-16T12:00:00.000Z',
		})
		expect(message.embeds?.[0]?.fields?.[0]).toMatchObject({
			name: 'Characters',
		})
		expect(message.embeds?.[0]?.fields?.[0]?.value).toContain('• Alpha One')
		expect(message.embeds?.[0]?.fields?.[0]?.value).toContain('• +1 more')
	})

	it('only treats valid-to-invalid transitions as queueable', () => {
		expect(didTokenTransitionFromValidToInvalid(true, false)).toBe(true)
		expect(didTokenTransitionFromValidToInvalid(true, true)).toBe(false)
		expect(didTokenTransitionFromValidToInvalid(false, false)).toBe(false)
		expect(didTokenTransitionFromValidToInvalid(null, false)).toBe(false)
		expect(didTokenTransitionFromValidToInvalid(undefined, false)).toBe(false)
	})
})
