import { describe, expect, it } from 'vitest'

import { createDiscordRefreshWorkflowId } from '../workflow-triggers'

describe('Discord refresh workflow IDs', () => {
	it('contains the complete user identifier for exact ownership checks', () => {
		const userId = '12345678-1234-1234-1234-123456789abc'
		const workflowId = createDiscordRefreshWorkflowId('user-manual', userId)

		expect(workflowId).toMatch(
			/^discord-refresh-user-manual-12345678123412341234123456789abc-[a-z0-9]+$/
		)
	})
})
