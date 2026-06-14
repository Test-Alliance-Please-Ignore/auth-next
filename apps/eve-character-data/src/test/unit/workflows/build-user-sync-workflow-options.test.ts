import { describe, expect, it } from 'vitest'

import { buildUserSyncWorkflowOptions } from '../../../workflows/build-user-sync-workflow-options'

describe('buildUserSyncWorkflowOptions', () => {
	it('spreads user workflows across the full jitter window', async () => {
		const options = await buildUserSyncWorkflowOptions({
			userBatches: [
				{ userId: 'user-a', characterIds: ['1', '2'] },
				{ userId: 'user-b', characterIds: ['3'] },
				{ userId: 'user-c', characterIds: ['4', '5', '6'] },
			],
			trigger: 'cron',
			totalCount: 3,
			startIndex: 0,
			jitterWindowSeconds: 3600,
		})

		expect(options.map((option) => option.params.userId)).toEqual(['user-a', 'user-b', 'user-c'])
		expect(options.map((option) => option.params.jitterDelaySeconds)).toEqual([0, 1800, 3600])
	})

	it('offsets later pages from the global user index', async () => {
		const options = await buildUserSyncWorkflowOptions({
			userBatches: [
				{ userId: 'user-d', characterIds: ['7'] },
				{ userId: 'user-e', characterIds: ['8'] },
			],
			trigger: 'cron',
			totalCount: 5,
			startIndex: 3,
			jitterWindowSeconds: 3600,
		})

		expect(options.map((option) => option.params.jitterDelaySeconds)).toEqual([2700, 3600])
	})
})
