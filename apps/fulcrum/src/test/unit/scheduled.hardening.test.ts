import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scheduledHandler } from '../../scheduled'

vi.mock('../../db', () => ({
	createDb: vi.fn(() => ({ fake: true })),
}))

vi.mock('../../db/queries', () => ({
	getStaleInProgressReports: vi.fn(),
	updateReportStatus: vi.fn(),
	getExpiredReports: vi.fn(),
}))

import * as queries from '../../db/queries'

function makeEvent(cron: string): ScheduledEvent {
	return {
		cron,
		scheduledTime: Date.now(),
		noRetry: vi.fn(),
	} as unknown as ScheduledEvent
}

describe('scheduled hardening sweep', () => {
	const getStaleInProgressReportsMock = vi.mocked(queries.getStaleInProgressReports)
	const updateReportStatusMock = vi.mocked(queries.updateReportStatus)
	const getExpiredReportsMock = vi.mocked(queries.getExpiredReports)

	beforeEach(() => {
		vi.clearAllMocks()
		getStaleInProgressReportsMock.mockResolvedValue([])
		getExpiredReportsMock.mockResolvedValue([])
	})

	it('marks stale report failed when workflow is errored', async () => {
		getStaleInProgressReportsMock.mockResolvedValue([
			{
				id: 'report-1',
				characterId: '3001',
				status: 'pending',
				workflowInstanceId: 'wf-1',
				updatedAt: new Date(Date.now() - 60 * 60 * 1000),
			},
		] as any)

		const env = {
			DATABASE_URL: 'postgres://example',
			CHARACTER_REPORT_WORKFLOW: {
				get: vi.fn().mockResolvedValue({
					status: vi.fn().mockResolvedValue({
						status: 'errored',
						error: 'workflow failed upstream',
					}),
				}),
			},
			CHARACTER_REPORTS: { delete: vi.fn() },
		} as any

		await scheduledHandler(makeEvent('*/15 * * * *'), env, {} as ExecutionContext)

		expect(updateReportStatusMock).toHaveBeenCalledWith(
			expect.anything(),
			'report-1',
			'failed',
			expect.objectContaining({
				errorMessage: 'workflow failed upstream',
			}),
		)
	})

	it('does not fail stale report when workflow is still running', async () => {
		getStaleInProgressReportsMock.mockResolvedValue([
			{
				id: 'report-2',
				characterId: '3002',
				status: 'processing',
				workflowInstanceId: 'wf-2',
				updatedAt: new Date(Date.now() - 60 * 60 * 1000),
			},
		] as any)

		const env = {
			DATABASE_URL: 'postgres://example',
			CHARACTER_REPORT_WORKFLOW: {
				get: vi.fn().mockResolvedValue({
					status: vi.fn().mockResolvedValue({
						status: 'running',
					}),
				}),
			},
			CHARACTER_REPORTS: { delete: vi.fn() },
		} as any

		await scheduledHandler(makeEvent('*/15 * * * *'), env, {} as ExecutionContext)

		expect(updateReportStatusMock).not.toHaveBeenCalledWith(
			expect.anything(),
			'report-2',
			'failed',
			expect.anything(),
		)
	})

	it('marks stale report failed when workflow instance id is missing', async () => {
		getStaleInProgressReportsMock.mockResolvedValue([
			{
				id: 'report-3',
				characterId: '3003',
				status: 'pending',
				workflowInstanceId: null,
				updatedAt: new Date(Date.now() - 60 * 60 * 1000),
			},
		] as any)

		const env = {
			DATABASE_URL: 'postgres://example',
			CHARACTER_REPORT_WORKFLOW: {
				get: vi.fn(),
			},
			CHARACTER_REPORTS: { delete: vi.fn() },
		} as any

		await scheduledHandler(makeEvent('*/15 * * * *'), env, {} as ExecutionContext)

		expect(updateReportStatusMock).toHaveBeenCalledWith(
			expect.anything(),
			'report-3',
			'failed',
			expect.objectContaining({
				errorMessage: 'Stalled report recovery: missing workflow instance id',
			}),
		)
	})
})
