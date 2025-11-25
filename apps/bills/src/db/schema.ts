import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from 'drizzle-orm/pg-core'

/**
 * Enums for bill system
 */

export const billStatusEnum = pgEnum('bill_status', [
	'draft',
	'issued',
	'paid',
	'cancelled',
	'overdue',
])

export const entityTypeEnum = pgEnum('bill_entity_type', ['character', 'corporation', 'group'])

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
		id: uuid('id').defaultRandom().primaryKey(),
		issuerId: text('issuer_id').notNull(),
		payerId: text('payer_id').notNull(),
		payerType: entityTypeEnum('payer_type').notNull(),
		payeeId: text('payee_id'),
		payeeType: entityTypeEnum('payee_type'),
		templateId: uuid('template_id'),
		scheduleId: uuid('schedule_id'),
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
		paymentToken: text('payment_token').notNull().unique(), // 12-character secure token (max length for EVE wallet reason field)
		createdAt: timestamp('created_at').notNull().defaultNow(),
		updatedAt: timestamp('updated_at').notNull().defaultNow(),
		paymentLastCheckedAt: timestamp('payment_last_checked_at', { withTimezone: true }),
	},
	(table) => [
		index('bills_issuer_id_idx').on(table.issuerId),
		index('bills_payer_id_idx').on(table.payerId),
		index('bills_payee_id_idx').on(table.payeeId),
		index('bills_payee_type_idx').on(table.payeeType),
		index('bills_status_idx').on(table.status),
		index('bills_due_date_idx').on(table.dueDate),
		index('bills_template_id_idx').on(table.templateId),
		index('bills_schedule_id_idx').on(table.scheduleId),
		index('bills_payment_token_idx').on(table.paymentToken),
	]
)

export const billPayments = pgTable(
	'bill_payments',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		billId: uuid('bill_id')
			.notNull()
			.references(() => bills.id, { onDelete: 'cascade' }),
		paymentToken: text('payment_token').notNull(),
		esiTransactionId: text('esi_transaction_id').notNull(),
		amount: text('amount').notNull(),
		paidById: text('paid_by_id').notNull(),
		paidByType: entityTypeEnum('paid_by_type').notNull(),
		paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
	},
	(table) => [
		index('bill_payments_bill_id_idx').on(table.billId),
		index('bill_payments_payment_token_idx').on(table.paymentToken),
		index('bill_payments_esi_transaction_id_idx').on(table.esiTransactionId),
		unique('bill_payments_esi_transaction_id_unique').on(table.esiTransactionId),
		index('bill_payments_paid_by_id_idx').on(table.paidById),
		index('bill_payments_paid_by_type_idx').on(table.paidByType),
		index('bill_payments_paid_at_idx').on(table.paidAt),
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
		id: uuid('id').defaultRandom().primaryKey(),
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
		id: uuid('id').defaultRandom().primaryKey(),
		ownerId: text('owner_id').notNull(),
		templateId: uuid('template_id')
			.notNull()
			.references(() => billTemplates.id, { onDelete: 'restrict' }),
		payerId: text('payer_id').notNull(),
		payerType: entityTypeEnum('payer_type').notNull(),
		payeeId: text('payee_id'),
		payeeType: entityTypeEnum('payee_type'),
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
		index('bill_schedules_payee_id_idx').on(table.payeeId),
		index('bill_schedules_payee_type_idx').on(table.payeeType),
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
		id: uuid('id').defaultRandom().primaryKey(),
		scheduleId: uuid('schedule_id')
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

export const billsRelations = relations(bills, ({ one, many }) => ({
	schedule: one(billSchedules, {
		fields: [bills.scheduleId],
		references: [billSchedules.id],
	}),
	template: one(billTemplates, {
		fields: [bills.templateId],
		references: [billTemplates.id],
	}),
	payments: many(billPayments),
}))

export const billPaymentsRelations = relations(billPayments, ({ one }) => ({
	bill: one(bills, {
		fields: [billPayments.billId],
		references: [bills.id],
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
	billPayments,
	billTemplates,
	billSchedules,
	scheduleExecutionLogs,
	billsRelations,
	billPaymentsRelations,
	billTemplatesRelations,
	billSchedulesRelations,
	scheduleExecutionLogsRelations,
}
