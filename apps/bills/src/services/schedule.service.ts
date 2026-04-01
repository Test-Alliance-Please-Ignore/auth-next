import { and, desc, eq, inArray, sql } from '@repo/db-utils'

import { billSchedules, billTemplates, scheduleExecutionLogs } from '../db/schema'
import { calculateInitialGenerationTime, calculateNextGenerationTime } from '../utils/schedule'
import { generateUuidV7 } from '../utils/uuid'

/** Encode owner/admins/members booleans into a single bitmask integer (1=owner, 2=admins, 4=members) */
function encodeGroupBillMask(
	includeOwner: boolean,
	includeAdmins: boolean,
	includeMembers: boolean
): number {
	return (includeOwner ? 1 : 0) | (includeAdmins ? 2 : 0) | (includeMembers ? 4 : 0)
}

/** Decode bitmask into [includeOwner, includeAdmins, includeMembers] */
function decodeGroupBillMask(mask: number): [boolean, boolean, boolean] {
	return [(mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0]
}

import type {
	BillSchedule,
	BillScheduleWithDetails,
	CreateScheduleInput,
	OwnershipScope,
	ScheduleExecutionLog,
	ScheduleFilters,
	ScheduleStatistics,
	UpdateScheduleInput,
} from '@repo/bills'
import type { BillsDb } from '../db'

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

		const scheduleId = generateUuidV7()
		const nextGenerationTime = calculateInitialGenerationTime(data.frequency, data.startDate)
		if (!data.payeeId.trim()) {
			throw new Error('Payee is required')
		}

		const [schedule] = await this.db
			.insert(billSchedules)
			.values({
				id: scheduleId,
				ownerId: userId,
				templateId: data.templateId,
				payerId: data.payerId,
				payerType: data.payerType,
				payeeId: data.payeeId,
				payeeType: data.payeeType,
				frequency: data.frequency,
				amount: data.amount,
				nextGenerationTime,
				isActive: true,
				consecutiveFailures: 0,
				groupBillTargetMask: encodeGroupBillMask(
					data.groupBillIncludeOwner ?? true,
					data.groupBillIncludeAdmins ?? true,
					data.groupBillIncludeMembers ?? true
				),
			})
			.returning()

		return this.toScheduleResponse(schedule)
	}

	/**
	 * Get a specific schedule
	 */
	async getSchedule(
		userId: string,
		scheduleId: string,
		scope: OwnershipScope = 'owned'
	): Promise<BillScheduleWithDetails | null> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
			with: {
				template: true,
			},
		})

		if (!schedule) {
			return null
		}

		// Authorization: non-admin scope requires ownership
		if (scope !== 'all' && schedule.ownerId !== userId) {
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
	async listSchedules(
		userId: string,
		filters: ScheduleFilters = {},
		scope: OwnershipScope = 'owned'
	): Promise<BillScheduleWithDetails[]> {
		const conditions = scope === 'all' ? [] : [eq(billSchedules.ownerId, userId)]

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
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined

		const schedules = await this.db.query.billSchedules.findMany({
			where: whereClause,
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
			.where(inArray(scheduleExecutionLogs.scheduleId, scheduleIds))
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
	 * Update a schedule
	 */
	async updateSchedule(
		_userId: string,
		scheduleId: string,
		data: UpdateScheduleInput
	): Promise<BillSchedule> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if ((data.payerId && !data.payerType) || (!data.payerId && data.payerType)) {
			throw new Error('payerId and payerType must be provided together')
		}
		if ((data.payeeId && !data.payeeType) || (!data.payeeId && data.payeeType)) {
			throw new Error('payeeId and payeeType must be provided together')
		}
		if (data.payeeId !== undefined && !data.payeeId.trim()) {
			throw new Error('Payee is required')
		}

		// If frequency is changing, recalculate next generation time
		let nextGenerationTime = schedule.nextGenerationTime
		if (data.frequency && data.frequency !== schedule.frequency) {
			nextGenerationTime = calculateNextGenerationTime({
				frequency: data.frequency,
				lastGenerationTime: schedule.lastGenerationTime || undefined,
			})
		}

		// Extract group bill booleans before spreading (DB uses bitmask column instead)
		const { groupBillIncludeOwner, groupBillIncludeAdmins, groupBillIncludeMembers, ...restData } =
			data

		// Recompute mask if any group option is being updated
		const hasGroupOptions =
			groupBillIncludeOwner !== undefined ||
			groupBillIncludeAdmins !== undefined ||
			groupBillIncludeMembers !== undefined
		const [curOwner, curAdmins, curMembers] = decodeGroupBillMask(schedule.groupBillTargetMask ?? 7)
		const groupBillTargetMask = hasGroupOptions
			? encodeGroupBillMask(
					groupBillIncludeOwner ?? curOwner,
					groupBillIncludeAdmins ?? curAdmins,
					groupBillIncludeMembers ?? curMembers
				)
			: undefined

		const [updated] = await this.db
			.update(billSchedules)
			.set({
				...restData,
				...(groupBillTargetMask !== undefined && { groupBillTargetMask }),
				payeeId: data.payeeId?.trim(),
				nextGenerationTime,
				updatedAt: new Date(),
			})
			.where(eq(billSchedules.id, scheduleId))
			.returning()

		return this.toScheduleResponse(updated)
	}

	/**
	 * Pause a schedule
	 */
	async pauseSchedule(_userId: string, scheduleId: string): Promise<BillSchedule> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
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
	 * Resume a schedule
	 */
	async resumeSchedule(_userId: string, scheduleId: string): Promise<BillSchedule> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
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
	 * Delete a schedule
	 */
	async deleteSchedule(_userId: string, scheduleId: string): Promise<void> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
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
		limit = 50,
		scope: OwnershipScope = 'owned'
	): Promise<ScheduleExecutionLog[]> {
		const schedule = await this.db.query.billSchedules.findFirst({
			where: eq(billSchedules.id, scheduleId),
		})

		if (!schedule) {
			throw new Error('Schedule not found')
		}

		if (scope !== 'all' && schedule.ownerId !== userId) {
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
	async getScheduleStatistics(
		userId: string,
		scope: OwnershipScope = 'owned'
	): Promise<ScheduleStatistics> {
		const userSchedules = await this.db.query.billSchedules.findMany({
			where: scope === 'all' ? undefined : eq(billSchedules.ownerId, userId),
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
			where: and(
				eq(billSchedules.isActive, true),
				sql`${billSchedules.nextGenerationTime} <= ${now}`
			),
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
		const [includeOwner, includeAdmins, includeMembers] = decodeGroupBillMask(
			schedule.groupBillTargetMask ?? 7
		)
		return {
			id: schedule.id,
			ownerId: schedule.ownerId,
			templateId: schedule.templateId,
			payerId: schedule.payerId,
			payerType: schedule.payerType,
			payeeId: schedule.payeeId,
			payeeType: schedule.payeeType,
			frequency: schedule.frequency,
			amount: schedule.amount,
			nextGenerationTime: schedule.nextGenerationTime,
			lastGenerationTime: schedule.lastGenerationTime,
			isActive: schedule.isActive,
			consecutiveFailures: schedule.consecutiveFailures,
			groupBillIncludeOwner: includeOwner,
			groupBillIncludeAdmins: includeAdmins,
			groupBillIncludeMembers: includeMembers,
			createdAt: schedule.createdAt,
			updatedAt: schedule.updatedAt,
		}
	}
}
