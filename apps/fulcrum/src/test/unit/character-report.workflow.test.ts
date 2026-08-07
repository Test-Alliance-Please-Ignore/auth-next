import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CharacterReportWorkflow notifications step config', () => {
	it('uses a 10 minute timeout override for process-notifications', () => {
		const workflowPath = resolve(process.cwd(), 'src/workflows/character-report.workflow.ts')
		const source = readFileSync(workflowPath, 'utf8')

		expect(source).toContain('const NOTIFICATIONS_PROCESS_STEP: WorkflowStepConfig = {')
		expect(source).toContain("timeout: '10 minutes'")
		expect(source).toMatch(
			/doStep\(\s*'process-notifications',\s*NOTIFICATIONS_PROCESS_STEP,\s*\(\)\s*=>/
		)
	})
})
