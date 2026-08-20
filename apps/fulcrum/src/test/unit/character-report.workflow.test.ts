import { describe, expect, it } from 'vitest'

import { NOTIFICATIONS_PROCESS_STEP } from '../../workflows/character-report.workflow'

describe('CharacterReportWorkflow notifications step config', () => {
	it('uses a 10 minute timeout override for process-notifications', () => {
		expect(NOTIFICATIONS_PROCESS_STEP.timeout).toBe('10 minutes')
	})
})
