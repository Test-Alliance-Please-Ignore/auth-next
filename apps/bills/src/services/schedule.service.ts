import { and, desc, eq, sql } from '@repo/db-utils'

import type {
	BillSchedule,
	BillScheduleWithDetails,
	CreateScheduleInput,
	ScheduleExecutionLog,
	ScheduleFilters,
	ScheduleStatistics,
	UpdateScheduleInput,
} from '@repo/bills'
import type { BillsDb } from '../db'
import { billSchedules, billTemplates, scheduleExecutionLogs } from '../db/schema'
import {
	calculateInitialGenerationTime,
	calculateNextGenerationTime,
} from '../utils/schedule'
import { generateUuidV7 } from '../utils/uuid'

/**
 * Schedule Service
 *
 * Handles bill schedule operations including:
 * - Schedule CRUD operations
 * - Next generation time calculations
 * - Schedule execution logging
 * - Workflow integration helpers
 */
export class ScheduleService {
	constructor(private db: BillsDb) {}

	/**
	 * Create a new schedule
	 */
	async createSchedule(userId: string, data: CreateScheduleInput): Promise<BillSchedule> {
		// Verify template exists and user owns it
		const template = await this.db.query.billTemplates.findFirst({
			where: eq(billTemplates.id, data.templateId),
		})

		if (!template) {
			throw new Error('Template not found')
		}

		if (template.ownerId !== userId) {
			throw new Error('Not authorized to use this template')
		}

		const scheduleId = generateUuidV7()
		const nextGenerationTime = calculateInitialGenerationTime(data.frequency, data.startDate)

		const [schedule] = await this.db
			.insert(billSchedules)
			.values({
				id: scheduleId,
				ownerId: userId,
				templateId: data.templateId,
				payerId: data.payerId,
				payerType: data.payerType,
				frequency: data.frequency,
				amount: data.amount,
				nextGenerationTime,
				isActive: true,
				consecutiveFailures: 0,
			})
			.returning()

		return this.toScheduleResponse(schedule)
	}

	/**
	 * Get a specific schedule
	 */
	async getSchedule(userId: string, scheduleId: string): Promise<BillScheduleWithDetails | null> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
			with: {
				template: true,
			},
		})

		if (!schedule) {
			return null
		}

		// Authorization: User must be owner
		if (schedule.ownerId !== userId) {
			throw new Error('Not authorized to view this schedule')
		}

		// Get last execution log
		const lastExecution = await this.db.query.scheduleExecutionLogs.findFirst({
			where: eq(scheduleExecutionLogs.scheduleId, scheduleId),
			orderBy: desc(scheduleExecutionLogs.executedAt),
		})

		return {
			...this.toScheduleResponse(schedule),
			template: schedule.template,
			lastExecution: lastExecution || undefined,
		}
	}

	/**
	 * List schedules owned by user
	 */
	async listSchedules(userId: string, filters: ScheduleFilters = {}): Promise<BillScheduleWithDetails[]> {
		const conditions = [eq(billSchedules.ownerId, userId)]

		// Apply filters
		if (filters.isActive !== undefined) {
			conditions.push(eq(billSchedules.isActive, filters.isActive))
		}
		if (filters.frequency) {
			conditions.push(eq(billSchedules.frequency, filters.frequency))
		}
		if (filters.payerId) {
			conditions.push(eq(billSchedules.payerId, filters.payerId))
		}
		if (filters.templateId) {
			conditions.push(eq(billSchedules.templateId, filters.templateId))
		}

		const schedules = await this.db.query.billSchedules.findMany({
			where: and(...conditions),
			orderBy: (billSchedules, { desc }) => [desc(billSchedules.createdAt)],
			with: {
				template: true,
			},
		})

		// Get last execution logs
		const scheduleIds = schedules.map((s) => s.id)

		if (scheduleIds.length === 0) {
			return []
		}

		const lastExecutions = await this.db
			.select()
			.from(scheduleExecutionLogs)
			.where(sql`${scheduleExecutionLogs.scheduleId} = ANY(${scheduleIds})`)
			.orderBy(desc(scheduleExecutionLogs.executedAt))

		const executionMap = new Map<string, ScheduleExecutionLog>()
		for (const execution of lastExecutions) {
			if (!executionMap.has(execution.scheduleId)) {
				executionMap.set(execution.scheduleId, execution)
			}
		}

		return schedules.map((schedule) => ({
			...this.toScheduleResponse(schedule),
			template: schedule.template,
			lastExecution: executionMap.get(schedule.id),
		}))
	}

	/**
	 * Update a schedule (owner only)
	 */
	async updateSchedule(userId: string, scheduleId: string, data: UpdateScheduleInput): Promise<BillSchedule> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if (schedule.ownerId !== userId) {
			throw new Error('Only the owner can update the schedule')
		}

		// If frequency is changing, recalculate next generation time
		let nextGenerationTime = schedule.nextGenerationTime
		if (data.frequency && data.frequency !== schedule.frequency) {
			nextGenerationTime = calculateNextGenerationTime({
				frequency: data.frequency,
				lastGenerationTime: schedule.lastGenerationTime || undefined,
			})
		}

		const [updated] = await this.db
			.update(billSchedules)
			.set({
				...data,
				nextGenerationTime,
				updatedAt: new Date(),
			})
			.where(eq(billSchedules.id, scheduleId))
			.returning()

		return this.toScheduleResponse(updated)
	}

	/**
	 * Pause a schedule (owner only)
	 */
	async pauseSchedule(userId: string, scheduleId: string): Promise<BillSchedule> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if (schedule.ownerId !== userId) {
			throw new Error('Only the owner can pause the schedule')
		}

		if (!schedule.isActive) {
			throw new Error('Schedule is already paused')
		}

		const [updated] = await this.db
			.update(billSchedules)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(billSchedules.id, scheduleId))
			.returning()

		return this.toScheduleResponse(updated)
	}

	/**
	 * Resume a schedule (owner only)
	 */
	async resumeSchedule(userId: string, scheduleId: string): Promise<BillSchedule> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if (schedule.ownerId !== userId) {
			throw new Error('Only the owner can resume the schedule')
		}

		if (schedule.isActive) {
			throw new Error('Schedule is already active')
		}

		// Reset consecutive failures and recalculate next generation time
		const nextGenerationTime = calculateNextGenerationTime({
			frequency: schedule.frequency,
			startDate: new Date(),
		})

		const [updated] = await this.db
			.update(billSchedules)
			.set({
				isActive: true,
				consecutiveFailures: 0,
				nextGenerationTime,
				updatedAt: new Date(),
			})
			.where(eq(billSchedules.id, scheduleId))
			.returning()

		return this.toScheduleResponse(updated)
	}

	/**
	 * Delete a schedule (owner only)
	 */
	async deleteSchedule(userId: string, scheduleId: string): Promise<void> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if (schedule.ownerId !== userId) {
			throw new Error('Only the owner can delete the schedule')
		}

		// Execution logs will be cascade deleted due to foreign key
		await this.db.delete(billSchedules).where(eq(billSchedules.id, scheduleId))
	}

	/**
	 * Get schedule execution history
	 */
	async getScheduleExecutionLogs(
		userId: string,
		scheduleId: string,
		limit = 50
	): Promise<ScheduleExecutionLog[]> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if (schedule.ownerId !== userId) {
			throw new Error('Not authorized to view execution logs')
		}

		const logs = await this.db.query.scheduleExecutionLogs.findMany({
			where: eq(scheduleExecutionLogs.scheduleId, scheduleId),
			orderBy: desc(scheduleExecutionLogs.executedAt),
			limit,
		})

		return logs
	}

	/**
	 * Get schedule statistics for a user
	 */
	async getScheduleStatistics(userId: string): Promise<ScheduleStatistics> {
		const userSchedules = await this.db.query.billSchedules.findMany({
			where: eq(billSchedules.ownerId, userId),
		})

		const stats: ScheduleStatistics = {
			totalSchedules: userSchedules.length,
			activeSchedules: 0,
			pausedSchedules: 0,
			schedulesWithFailures: 0,
		}

		for (const schedule of userSchedules) {
			if (schedule.isActive) {
				stats.activeSchedules++
			} else {
				stats.pausedSchedules++
			}

			if (schedule.consecutiveFailures > 0) {
				stats.schedulesWithFailures++
			}
		}

		return stats
	}

	/**
	 * Update schedule after successful execution (internal use)
	 */
	async updateScheduleAfterExecution(
		scheduleId: string,
		generatedBillId: string,
		success: boolean,
		errorMessage?: string
	): Promise<void> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		const now = new Date()
		const logId = generateUuidV7()

		// Log execution
		await this.db.insert(scheduleExecutionLogs).values({
			id: logId,
			scheduleId,
			generatedBillId: success ? generatedBillId : null,
			executedAt: now,
			success,
			errorMessage: errorMessage || null,
		})

		// Update schedule
		const updates: any = {
			lastGenerationTime: now,
			updatedAt: now,
		}

		if (success) {
			// Reset consecutive failures and calculate next generation time
			updates.consecutiveFailures = 0
			updates.nextGenerationTime = calculateNextGenerationTime({
				frequency: schedule.frequency,
				lastGenerationTime: now,
			})
		} else {
			// Increment consecutive failures
			updates.consecutiveFailures = schedule.consecutiveFailures + 1

			// Auto-pause after 3 consecutive failures
			if (updates.consecutiveFailures >= 3) {
				updates.isActive = false
			}
		}

		await this.db.update(billSchedules).set(updates).where(eq(billSchedules.id, scheduleId))
	}

	/**
	 * Get schedules that need execution (internal use)
	 */
	async getSchedulesDueForExecution(): Promise<BillSchedule[]> {
		const now = new Date()

		const schedules = await this.db.query.billSchedules.findMany({
			where: and(eq(billSchedules.isActive, true), sql`${billSchedules.nextGenerationTime} <= ${now}`),
			with: {
				template: true,
			},
		})

		return schedules.map((s) => this.toScheduleResponse(s))
	}

	/**
	 * Convert database record to BillSchedule response
	 */
	private toScheduleResponse(schedule: any): BillSchedule {
		return {
			id: schedule.id,
			ownerId: schedule.ownerId,
			templateId: schedule.templateId,
			payerId: schedule.payerId,
			payerType: schedule.payerType,
			frequency: schedule.frequency,
			amount: schedule.amount,
			nextGenerationTime: schedule.nextGenerationTime,
			lastGenerationTime: schedule.lastGenerationTime,
			isActive: schedule.isActive,
			consecutiveFailures: schedule.consecutiveFailures,
			createdAt: schedule.createdAt,
			updatedAt: schedule.updatedAt,
		}
	}
}
