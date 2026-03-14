import { describe, expect, it, vi } from 'vitest'

import { TaxExportService } from '../tax-export.service'

describe('TaxExportService runDueExportSchedules', () => {
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
})
