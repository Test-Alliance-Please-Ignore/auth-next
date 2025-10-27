import { index, pgEnum, pgTable, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

/**
 * Enums for bill system
 */

export const billStatusEnum = pgEnum('bill_status', ['draft', 'issued', 'paid', 'cancelled', 'overdue'])

export const entityTypeEnum = pgEnum('entity_type', ['character', 'corporation', 'group'])

export const lateFeeTypeEnum = pgEnum('late_fee_type', ['none', 'static', 'percentage'])

export const lateFeeCompoundingEnum = pgEnum('late_fee_compounding', [
	'none',
	'daily',
	'weekly',
	'monthly',
])

export const scheduleFrequencyEnum = pgEnum('schedule_frequency', ['daily', 'weekly', 'monthly'])

/**
 * Bills table
 *
 * Main bills table storing all bill records.
 * Bills can be created directly or generated from templates/schedules.
 */
export const bills = pgTable(
	'bills',
	{
		id: text('id').primaryKey(),
		issuerId: text('issuer_id').notNull(),
		payerId: text('payer_id').notNull(),
		payerType: entityTypeEnum('payer_type').notNull(),
		templateId: text('template_id'),
		scheduleId: text('schedule_id'),
		title: text('title').notNull(),
		description: text('description'),
		amount: text('amount').notNull(), // ISK amounts as text to avoid BigInt issues
		lateFee: text('late_fee').notNull().default('0'), // Calculated late fee amount
		lateFeeType: lateFeeTypeEnum('late_fee_type').notNull().default('none'),
		lateFeeAmount: text('late_fee_amount').notNull().default('0'),
		lateFeeCompounding: lateFeeCompoundingEnum('late_fee_compounding').notNull().default('none'),
		dueDate: timestamp('due_date').notNull(),
		status: billStatusEnum('status').notNull().default('draft'),
		paidAt: timestamp('paid_at'),
		paymentToken: text('payment_token').notNull().unique(), // 32-byte secure token
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => [
		index('bills_issuer_id_idx').on(table.issuerId),
		index('bills_payer_id_idx').on(table.payerId),
		index('bills_status_idx').on(table.status),
		index('bills_due_date_idx').on(table.dueDate),
		index('bills_template_id_idx').on(table.templateId),
		index('bills_schedule_id_idx').on(table.scheduleId),
		index('bills_payment_token_idx').on(table.paymentToken),
	]
)

/**
 * Bill Templates table
 *
 * Reusable templates for creating bills.
 * Templates support parameterization for dynamic content.
 */
export const billTemplates = pgTable(
	'bill_templates',
	{
		id: text('id').primaryKey(),
		ownerId: text('owner_id').notNull(),
		name: text('name').notNull(),
		description: text('description'),
		amountTemplate: text('amount_template').notNull().default('{amount}'),
		titleTemplate: text('title_template').notNull(),
		descriptionTemplate: text('description_template'),
		lateFeeType: lateFeeTypeEnum('late_fee_type').notNull().default('none'),
		lateFeeAmount: text('late_fee_amount').notNull().default('0'),
		lateFeeCompounding: lateFeeCompoundingEnum('late_fee_compounding').notNull().default('none'),
		daysUntilDue: integer('days_until_due').notNull().default(30),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => [index('bill_templates_owner_id_idx').on(table.ownerId)]
)

/**
 * Bill Schedules table
 *
 * Recurring bill schedules that automatically generate bills.
 * Schedules are linked to templates and execute via Cloudflare Workflows.
 */
export const billSchedules = pgTable(
	'bill_schedules',
	{
		id: text('id').primaryKey(),
		ownerId: text('owner_id').notNull(),
		templateId: text('template_id')
			.notNull()
			.references(() => billTemplates.id, { onDelete: 'restrict' }),
		payerId: text('payer_id').notNull(),
		payerType: entityTypeEnum('payer_type').notNull(),
		frequency: scheduleFrequencyEnum('frequency').notNull(),
		amount: text('amount').notNull(), // Amount to use when generating bills
		nextGenerationTime: timestamp('next_generation_time').notNull(),
		lastGenerationTime: timestamp('last_generation_time'),
		isActive: boolean('is_active').notNull().default(true),
		consecutiveFailures: integer('consecutive_failures').notNull().default(0),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
	},
	(table) => [
		index('bill_schedules_owner_id_idx').on(table.ownerId),
		index('bill_schedules_template_id_idx').on(table.templateId),
		index('bill_schedules_payer_id_idx').on(table.payerId),
		index('bill_schedules_next_generation_time_idx').on(table.nextGenerationTime),
		index('bill_schedules_is_active_idx').on(table.isActive),
	]
)

/**
 * Schedule Execution Logs table
 *
 * Audit trail for schedule executions.
 * Records both successful bill generations and failures.
 */
export const scheduleExecutionLogs = pgTable(
	'schedule_execution_logs',
	{
		id: text('id').primaryKey(),
		scheduleId: text('schedule_id')
			.notNull()
			.references(() => billSchedules.id, { onDelete: 'cascade' }),
		generatedBillId: text('generated_bill_id'),
		executedAt: timestamp('executed_at').notNull().defaultNow(),
		success: boolean('success').notNull(),
		errorMessage: text('error_message'),
	},
	(table) => [
		index('schedule_execution_logs_schedule_id_idx').on(table.scheduleId),
		index('schedule_execution_logs_executed_at_idx').on(table.executedAt),
	]
)

/**
 * Drizzle ORM Relations
 */

export const billsRelations = relations(bills, ({ one }) => ({
	schedule: one(billSchedules, {
		fields: [bills.scheduleId],
		references: [billSchedules.id],
	}),
	template: one(billTemplates, {
		fields: [bills.templateId],
		references: [billTemplates.id],
	}),
}))

export const billTemplatesRelations = relations(billTemplates, ({ many }) => ({
	schedules: many(billSchedules),
	bills: many(bills),
}))

export const billSchedulesRelations = relations(billSchedules, ({ one, many }) => ({
	template: one(billTemplates, {
		fields: [billSchedules.templateId],
		references: [billTemplates.id],
	}),
	bills: many(bills),
	executionLogs: many(scheduleExecutionLogs),
}))

export const scheduleExecutionLogsRelations = relations(scheduleExecutionLogs, ({ one }) => ({
	schedule: one(billSchedules, {
		fields: [scheduleExecutionLogs.scheduleId],
		references: [billSchedules.id],
	}),
}))

/**
 * Export schema for Drizzle queries
 */
export const schema = {
	bills,
	billTemplates,
	billSchedules,
	scheduleExecutionLogs,
	billsRelations,
	billTemplatesRelations,
	billSchedulesRelations,
	scheduleExecutionLogsRelations,
}
