import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scheduledHandler } from '../../scheduled'

const getStubMock = vi.fn()
const loggerInfoMock = vi.fn()
const loggerErrorMock = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: (...args: unknown[]) => getStubMock(...args),
}))

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		info: (...args: unknown[]) => loggerInfoMock(...args),
		error: (...args: unknown[]) => loggerErrorMock(...args),
	},
	withWorkerLogContext: async (_name: string, _env: unknown, callback: () => Promise<void>) =>
		callback(),
}))

describe('scheduledHandler', () => {
	const event = {
		cron: '0 2 * * *',
		scheduledTime: Date.parse('2026-03-11T19:00:00.000Z'),
	} as ScheduledEvent
	const env = {
		CORPORATION_TAX: {},
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('runs scheduled operations when worker call succeeds', async () => {
		const stub = {
			runScheduledOperations: vi.fn().mockResolvedValue({
				asOf: new Date('2026-03-11T19:00:00.000Z'),
				includedCorporationCount: 2,
				dailyIngestCorporationsProcessed: 2,
				dailyIngestFailures: 0,
				monthlyAssessmentCorporationsProcessed: 1,
				monthlyAssessmentFailures: 0,
				ledgerRetentionCorporationsProcessed: 2,
				ledgerRetentionFailures: 0,
				ledgerRetentionEntriesDeleted: 14,
				dueExportSchedulesProcessed: 3,
				failedAlertDeliveriesRetried: 2,
			}),
			triggerAlert: vi.fn(),
		}
		getStubMock.mockReturnValue(stub)

		await scheduledHandler(event, env, {} as ExecutionContext)

		expect(stub.runScheduledOperations).toHaveBeenCalledOnce()
		expect(stub.runScheduledOperations).toHaveBeenCalledWith(
			'system:corporation-tax:scheduler',
			new Date('2026-03-11T19:00:00.000Z'),
			25,
			100
		)
		expect(stub.triggerAlert).not.toHaveBeenCalled()
	})

	it('emits scheduled failure alert when worker call fails', async () => {
		const stub = {
			runScheduledOperations: vi.fn().mockRejectedValue(new Error('boom')),
			triggerAlert: vi.fn().mockResolvedValue({}),
		}
		getStubMock.mockReturnValue(stub)

		await expect(scheduledHandler(event, env, {} as ExecutionContext)).resolves.toBeUndefined()
		expect(stub.triggerAlert).toHaveBeenCalledOnce()
		expect(stub.triggerAlert).toHaveBeenCalledWith(
			'system:corporation-tax:scheduler',
			expect.objectContaining({
				corporationId: null,
				alertType: 'scheduled_operations_failed',
				severity: 'critical',
				dedupeKey: 'scheduled-operations-failed:0 2 * * *',
			})
		)
	})
})
