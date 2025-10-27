import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { createDb } from '../../db'
import { withNeonTestBranch } from '../setup'

import type { Bills, CreateScheduleInput } from '@repo/bills'

beforeAll(() => {
	withNeonTestBranch()
})

describe('Schedules Integration Tests', () => {
	let db: ReturnType<typeof createDb>
	let billsStub: Bills
	const TEST_USER_ID = 'test-user-123'
	const TEST_PAYER_ID = 'test-payer-456'
	let testTemplateId: string

	beforeAll(async () => {
		if (!env.DATABASE_URL) {
			throw new Error('DATABASE_URL is not set')
		}

		const db = createDb(env.DATABASE_URL!)
		// Create mock stub
		const { ScheduleService } = await import('../../services/schedule.service')
		const { TemplateService } = await import('../../services/template.service')
		const scheduleService = new ScheduleService(db)
		const templateService = new TemplateService(db)

		// Create a template for testing schedules
		const template = await templateService.createTemplate(TEST_USER_ID, {
			name: 'Test Schedule Template',
			titleTemplate: 'Recurring Bill {count}',
			daysUntilDue: 7,
		})
		testTemplateId = template.id

		billsStub = {
			createSchedule: (userId: string, data: CreateScheduleInput) =>
				scheduleService.createSchedule(userId, data),
			getSchedule: (userId: string, scheduleId: string) =>
				scheduleService.getSchedule(userId, scheduleId),
			listSchedules: (userId: string, filters?: any) =>
				scheduleService.listSchedules(userId, filters),
			updateSchedule: (userId: string, scheduleId: string, data: any) =>
				scheduleService.updateSchedule(userId, scheduleId, data),
			pauseSchedule: (userId: string, scheduleId: string) =>
				scheduleService.pauseSchedule(userId, scheduleId),
			resumeSchedule: (userId: string, scheduleId: string) =>
				scheduleService.resumeSchedule(userId, scheduleId),
			deleteSchedule: (userId: string, scheduleId: string) =>
				scheduleService.deleteSchedule(userId, scheduleId),
			getScheduleExecutionLogs: (userId: string, scheduleId: string, limit?: number) =>
				scheduleService.getScheduleExecutionLogs(userId, scheduleId, limit),
			getScheduleStatistics: (userId: string) => scheduleService.getScheduleStatistics(userId),
		} as any
	})

	describe('Schedule CRUD', () => {
		it('should create a schedule', async () => {
			const scheduleData: CreateScheduleInput = {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'monthly',
				amount: '1000000',
			}

			const schedule = await billsStub.createSchedule(TEST_USER_ID, scheduleData)

			expect(schedule).toBeDefined()
			expect(schedule.id).toBeTruthy()
			expect(schedule.ownerId).toBe(TEST_USER_ID)
			expect(schedule.templateId).toBe(testTemplateId)
			expect(schedule.frequency).toBe('monthly')
			expect(schedule.amount).toBe('1000000')
			expect(schedule.isActive).toBe(true)
			expect(schedule.consecutiveFailures).toBe(0)
			expect(schedule.nextGenerationTime).toBeDefined()
		})

		it('should list schedules for a user', async () => {
			await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'weekly',
				amount: '500000',
			})

			await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'daily',
				amount: '100000',
			})

			const schedules = await billsStub.listSchedules(TEST_USER_ID)

			expect(schedules.length).toBeGreaterThanOrEqual(2)
		})

		it('should filter schedules by frequency', async () => {
			const dailySchedules = await billsStub.listSchedules(TEST_USER_ID, {
				frequency: 'daily',
			})

			expect(dailySchedules.length).toBeGreaterThan(0)
			dailySchedules.forEach((schedule) => {
				expect(schedule.frequency).toBe('daily')
			})
		})

		it('should update a schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'monthly',
				amount: '1000000',
			})

			const updated = await billsStub.updateSchedule(TEST_USER_ID, schedule.id, {
				amount: '1500000',
			})

			expect(updated.amount).toBe('1500000')
			expect(updated.frequency).toBe('monthly')
		})

		it('should delete a schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'weekly',
				amount: '250000',
			})

			await billsStub.deleteSchedule(TEST_USER_ID, schedule.id)

			await expect(billsStub.getSchedule(TEST_USER_ID, schedule.id)).resolves.toBeNull()
		})
	})

	describe('Schedule State Management', () => {
		it('should pause an active schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'monthly',
				amount: '1000000',
			})

			const paused = await billsStub.pauseSchedule(TEST_USER_ID, schedule.id)

			expect(paused.isActive).toBe(false)
		})

		it('should resume a paused schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'daily',
				amount: '50000',
			})

			await billsStub.pauseSchedule(TEST_USER_ID, schedule.id)
			const resumed = await billsStub.resumeSchedule(TEST_USER_ID, schedule.id)

			expect(resumed.isActive).toBe(true)
			expect(resumed.consecutiveFailures).toBe(0)
		})

		it('should not pause an already paused schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'weekly',
				amount: '100000',
			})

			await billsStub.pauseSchedule(TEST_USER_ID, schedule.id)

			await expect(billsStub.pauseSchedule(TEST_USER_ID, schedule.id)).rejects.toThrow(
				'already paused'
			)
		})

		it('should not resume an active schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'monthly',
				amount: '200000',
			})

			await expect(billsStub.resumeSchedule(TEST_USER_ID, schedule.id)).rejects.toThrow(
				'already active'
			)
		})
	})

	describe('Schedule Statistics', () => {
		it('should calculate schedule statistics', async () => {
			// Create multiple schedules with different states
			const schedule1 = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'daily',
				amount: '50000',
			})

			const schedule2 = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'weekly',
				amount: '100000',
			})

			await billsStub.pauseSchedule(TEST_USER_ID, schedule2.id)

			const stats = await billsStub.getScheduleStatistics(TEST_USER_ID)

			expect(stats.totalSchedules).toBeGreaterThanOrEqual(2)
			expect(stats.activeSchedules).toBeGreaterThanOrEqual(1)
			expect(stats.pausedSchedules).toBeGreaterThanOrEqual(1)
		})
	})

	describe('Schedule Authorization', () => {
		it('should only allow owner to update schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'monthly',
				amount: '1000000',
			})

			await expect(
				billsStub.updateSchedule('different-user', schedule.id, { amount: '999999' })
			).rejects.toThrow('Only the owner can update')
		})

		it('should only allow owner to delete schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'weekly',
				amount: '500000',
			})

			await expect(billsStub.deleteSchedule('different-user', schedule.id)).rejects.toThrow(
				'Only the owner can delete'
			)
		})
	})

	describe('Next Generation Time', () => {
		it('should set correct next generation time for daily schedule', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'daily',
				amount: '10000',
			})

			const now = new Date()
			const nextGen = new Date(schedule.nextGenerationTime)

			// Should be roughly 1 day from now
			const hoursDiff = (nextGen.getTime() - now.getTime()) / (1000 * 60 * 60)
			expect(hoursDiff).toBeGreaterThan(23)
			expect(hoursDiff).toBeLessThan(25)
		})

		it('should update next generation time when frequency changes', async () => {
			const schedule = await billsStub.createSchedule(TEST_USER_ID, {
				templateId: testTemplateId,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				frequency: 'daily',
				amount: '10000',
			})

			const originalNextGen = schedule.nextGenerationTime

			const updated = await billsStub.updateSchedule(TEST_USER_ID, schedule.id, {
				frequency: 'weekly',
			})

			// Next generation time should be different
			expect(updated.nextGenerationTime).not.toEqual(originalNextGen)
		})
	})
})
