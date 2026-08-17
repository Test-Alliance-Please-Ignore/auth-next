import { describe, expect, it, vi } from 'vitest'

import { TaxExportService } from '../tax-export.service'

describe('TaxExportService runDueExportSchedules', () => {
	it('passes income source selectors to the income sources report', async () => {
		const getTopIncomeSourcesReport = vi.fn().mockResolvedValue([])
		const service = new TaxExportService({} as any, { getTopIncomeSourcesReport } as any)

		await (service as any).getReportRows({
			reportType: 'top_income_sources',
			corporationId: '1001',
			filters: {
				fromDate: '2026-07-01T00:00:00.000Z',
				toDate: '2026-08-31T23:59:59.999Z',
				refTypes: ['bounty_prizes'],
				incomeMode: 'assessed',
				walletSource: 'corporation',
			},
		})

		expect(getTopIncomeSourcesReport).toHaveBeenCalledWith({
			corporationId: '1001',
			fromDate: new Date('2026-07-01T00:00:00.000Z'),
			toDate: new Date('2026-08-31T23:59:59.999Z'),
			refTypes: ['bounty_prizes'],
			incomeMode: 'assessed',
			walletSource: 'corporation',
			limit: 200,
			offset: 0,
		})
	})

	it('passes player wallet income source selection to the export report', async () => {
		const getTopIncomeSourcesReport = vi.fn().mockResolvedValue([])
		const service = new TaxExportService({} as any, { getTopIncomeSourcesReport } as any)

		await (service as any).getReportRows({
			reportType: 'top_income_sources',
			filters: {
				walletSource: 'character',
				incomeMode: 'total',
			},
		})

		expect(getTopIncomeSourcesReport).toHaveBeenCalledWith({
			incomeMode: 'total',
			walletSource: 'character',
			limit: 200,
			offset: 0,
		})
	})

	it('returns processed count and failure details for failed schedules', async () => {
		const scheduleRows = [
			{
				id: 'schedule-ok',
				corporationId: '3001',
				createdByUserId: 'user-1',
				format: 'csv',
				reportType: 'summary',
				frequency: 'weekly',
				filters: null,
				nextRunAt: new Date('2026-03-10T00:00:00.000Z'),
			},
			{
				id: 'schedule-fail',
				corporationId: '3002',
				createdByUserId: 'user-2',
				format: 'csv',
				reportType: 'summary',
				frequency: 'weekly',
				filters: null,
				nextRunAt: new Date('2026-03-10T00:00:00.000Z'),
			},
		]

		const updateWhere = vi.fn().mockResolvedValue(undefined)
		const updateSet = vi.fn().mockReturnValue({
			where: updateWhere,
		})
		const update = vi.fn().mockReturnValue({
			set: updateSet,
		})

		const mockDb: any = {
			query: {
				taxExportSchedules: {
					findMany: vi.fn().mockResolvedValue(scheduleRows),
				},
			},
			update,
		}
		const service = new TaxExportService(mockDb, {} as any)
		const requestExportSpy = vi.spyOn(service, 'requestExport')
		requestExportSpy.mockImplementation(async (actorUserId) => {
			if (actorUserId === 'user-2') {
				throw new Error('export schedule failed')
			}
			return {
				id: 'export-1',
				corporationId: '3001',
				requestedByUserId: actorUserId,
				format: 'csv',
				reportType: 'summary',
				status: 'completed',
				filters: null,
				rowCount: 1,
				sourceEsiVersion: 'esi-v1',
				error: null,
				requestedAt: new Date(),
				completedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			}
		})

		const result = await service.runDueExportSchedules(new Date('2026-03-11T00:00:00.000Z'), 10)

		expect(result.processed).toBe(1)
		expect(result.failures).toEqual([
			{
				scheduleId: 'schedule-fail',
				corporationId: '3002',
				error: 'export schedule failed',
			},
		])
		expect(update).toHaveBeenCalledTimes(1)
		expect(updateWhere).toHaveBeenCalledTimes(1)
	})

	it('does not advance schedule when requestExport returns a failed record', async () => {
		const scheduleRows = [
			{
				id: 'schedule-failed-record',
				corporationId: '3003',
				createdByUserId: 'user-3',
				format: 'csv',
				reportType: 'summary',
				frequency: 'weekly',
				filters: null,
				nextRunAt: new Date('2026-03-10T00:00:00.000Z'),
			},
		]

		const updateWhere = vi.fn().mockResolvedValue(undefined)
		const updateSet = vi.fn().mockReturnValue({
			where: updateWhere,
		})
		const update = vi.fn().mockReturnValue({
			set: updateSet,
		})

		const mockDb: any = {
			query: {
				taxExportSchedules: {
					findMany: vi.fn().mockResolvedValue(scheduleRows),
				},
			},
			update,
		}
		const service = new TaxExportService(mockDb, {} as any)
		const requestExportSpy = vi.spyOn(service, 'requestExport')
		requestExportSpy.mockResolvedValue({
			id: 'export-failed-1',
			corporationId: '3003',
			requestedByUserId: 'user-3',
			format: 'csv',
			reportType: 'summary',
			status: 'failed',
			filters: null,
			rowCount: null,
			sourceEsiVersion: 'esi-v1',
			error: 'generation failed',
			requestedAt: new Date(),
			completedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		})

		const result = await service.runDueExportSchedules(new Date('2026-03-11T00:00:00.000Z'), 10)

		expect(result.processed).toBe(0)
		expect(result.failures).toEqual([
			{
				scheduleId: 'schedule-failed-record',
				corporationId: '3003',
				error: 'generation failed',
			},
		])
		expect(update).not.toHaveBeenCalled()
		expect(updateSet).not.toHaveBeenCalled()
		expect(updateWhere).not.toHaveBeenCalled()
	})
})
