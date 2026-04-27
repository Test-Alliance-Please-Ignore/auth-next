import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../db', () => ({
	createDb: vi.fn(() => ({ fake: true })),
}))

vi.mock('../../db/queries', () => ({
	getInProgressReportForCharacter: vi.fn(),
	createCharacterReport: vi.fn(),
	updateReportStatus: vi.fn(),
	getReport: vi.fn(),
}))

vi.mock('../../lib/discord-webhook', () => ({
	sendBatchReportStartedDM: vi.fn(),
	sendBatchReportFinishedDM: vi.fn(),
}))

vi.mock('../../lib/report-metadata', () => ({
	resolveBatchReportMetadata: vi.fn(),
}))

import * as queries from '../../db/queries'
import {
	sendBatchReportFinishedDM,
	sendBatchReportStartedDM,
} from '../../lib/discord-webhook'
import { resolveBatchReportMetadata } from '../../lib/report-metadata'
import {
	runBulkCharacterReportWorkflow,
} from '../../workflows/bulk-character-report.runner'

type StepLike = {
	do: <T>(name: string, _config: unknown, fn: () => Promise<T>) => Promise<T>
}

function makeStep(): StepLike {
	return {
		do: async (_name, _config, fn) => fn(),
	}
}

describe('BulkCharacterReportWorkflow', () => {
	const getInProgressReportForCharacterMock = vi.mocked(queries.getInProgressReportForCharacter)
	const createCharacterReportMock = vi.mocked(queries.createCharacterReport)
	const updateReportStatusMock = vi.mocked(queries.updateReportStatus)
	const getReportMock = vi.mocked(queries.getReport)
	const sendBatchStartedMock = vi.mocked(sendBatchReportStartedDM)
	const sendBatchFinishedMock = vi.mocked(sendBatchReportFinishedDM)
	const resolveBatchMetadataMock = vi.mocked(resolveBatchReportMetadata)

	beforeEach(() => {
		vi.clearAllMocks()
		resolveBatchMetadataMock.mockResolvedValue({
			requestorMainCharacterName: 'Main Pilot',
			corporationTicker: 'TST',
		})
		getInProgressReportForCharacterMock.mockResolvedValue(undefined as any)
	})

	it('suppresses batch DMs when sendDm is false', async () => {
		const uuidValues = [
			'11111111-1111-4111-8111-111111111111',
			'22222222-2222-4222-8222-222222222222',
		] as const
		let uuidIndex = 0
		const uuidSpy = vi
			.spyOn(globalThis.crypto, 'randomUUID')
			.mockImplementation(() => uuidValues[Math.min(uuidIndex++, uuidValues.length - 1)]!)

		const env = {
			DATABASE_URL: 'postgres://example',
			CHARACTER_REPORT_WORKFLOW: {
				create: vi.fn().mockResolvedValue({ id: 'child-wf-1' }),
				get: vi.fn(),
			},
		}

		getReportMock.mockResolvedValue({ status: 'completed' } as any)

		await runBulkCharacterReportWorkflow(
			env as any,
			makeStep().do as any,
			'batch-1',
			{
				characterIds: ['3001'],
				requestorUserId: 'user-1',
				requestorCorporationId: '1001',
				requestSource: 'hr',
				sendDm: false,
			},
		)

		expect(sendBatchStartedMock).not.toHaveBeenCalled()
		expect(sendBatchFinishedMock).not.toHaveBeenCalled()
		expect(createCharacterReportMock).toHaveBeenCalledTimes(1)

		uuidSpy.mockRestore()
	})

	it('continues batch when one child workflow fails to start and summarizes mixed outcomes', async () => {
		const uuidValues = [
			'11111111-1111-4111-8111-111111111111',
			'22222222-2222-4222-8222-222222222222',
		] as const
		let uuidIndex = 0
		const uuidSpy = vi
			.spyOn(globalThis.crypto, 'randomUUID')
			.mockImplementation(() => uuidValues[Math.min(uuidIndex++, uuidValues.length - 1)]!)

		const childWorkflowCreate = vi
			.fn()
			.mockResolvedValueOnce({ id: 'child-wf-1' })
			.mockRejectedValueOnce(new Error('workflow start failed'))

		const env = {
			DATABASE_URL: 'postgres://example',
			CHARACTER_REPORT_WORKFLOW: {
				create: childWorkflowCreate,
				get: vi.fn(),
			},
		}

		getReportMock.mockImplementation(async (_db, reportId) => {
			if (reportId === '11111111-1111-4111-8111-111111111111') {
				return { id: '11111111-1111-4111-8111-111111111111', status: 'completed' } as any
			}
			if (reportId === '22222222-2222-4222-8222-222222222222') {
				return { id: '22222222-2222-4222-8222-222222222222', status: 'failed' } as any
			}
			return undefined
		})

		await runBulkCharacterReportWorkflow(
			env as any,
			makeStep().do as any,
			'batch-2',
			{
				characterIds: ['3001', '3002'],
				requestorUserId: 'user-1',
				requestorCorporationId: '1001',
				requestSource: 'hr',
				sendDm: true,
			},
		)

		expect(childWorkflowCreate).toHaveBeenCalledTimes(2)
		expect(updateReportStatusMock).toHaveBeenCalledWith(
			expect.anything(),
			'11111111-1111-4111-8111-111111111111',
			'pending',
			expect.objectContaining({ workflowInstanceId: 'child-wf-1' }),
		)
		expect(updateReportStatusMock).toHaveBeenCalledWith(
			expect.anything(),
			'22222222-2222-4222-8222-222222222222',
			'failed',
			expect.objectContaining({
				errorMessage: expect.stringContaining('Failed to start child workflow'),
			}),
		)

		expect(sendBatchStartedMock).toHaveBeenCalledTimes(1)
		expect(sendBatchFinishedMock).toHaveBeenCalledWith(
			expect.anything(),
			'user-1',
			expect.objectContaining({
				batchId: 'batch-2',
				totalCharacters: 2,
			}),
			{
				completed: 1,
				failed: 1,
				cancelled: 0,
				other: 0,
			},
		)

		uuidSpy.mockRestore()
	})
})
