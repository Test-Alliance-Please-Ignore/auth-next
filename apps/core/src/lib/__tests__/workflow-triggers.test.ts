import { describe, expect, it } from 'vitest'

import {
	createDirectorHealthRecheckWorkflowId,
	createDiscordRefreshWorkflowId,
} from '../workflow-triggers'

describe('Director health recheck workflow IDs', () => {
	it('deduplicates the same character and corporation within a five-minute window', () => {
		const now = 1_699_999_801_000

		expect(createDirectorHealthRecheckWorkflowId('123', '456', now)).toBe(
			createDirectorHealthRecheckWorkflowId('123', '456', now + 4 * 60 * 1000)
		)
		expect(createDirectorHealthRecheckWorkflowId('123', '456', now)).not.toBe(
			createDirectorHealthRecheckWorkflowId('123', '456', now + 5 * 60 * 1000)
		)
		expect(createDirectorHealthRecheckWorkflowId('123', '456', now)).not.toBe(
			createDirectorHealthRecheckWorkflowId('123', '789', now)
		)
	})
})

describe('Discord refresh workflow IDs', () => {
	it('contains the complete user identifier for exact ownership checks', () => {
		const userId = '12345678-1234-1234-1234-123456789abc'
		const workflowId = createDiscordRefreshWorkflowId('user-manual', userId)

		expect(workflowId).toMatch(
			/^discord-refresh-user-manual-12345678123412341234123456789abc-[a-z0-9]+$/
		)
	})
})
