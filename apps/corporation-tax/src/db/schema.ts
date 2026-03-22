import { relations, sql } from 'drizzle-orm'
import {
	boolean,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	varchar,
} from 'drizzle-orm/pg-core'

/**
 * Corporation exclusion list for tax engine/report scope overrides.
 */
export const taxCorporationExclusions = pgTable(
	'tax_corporation_exclusions',
	{
		corporationId: text('corporation_id').primaryKey(),
		reason: text('reason'),
		createdBy: text('created_by').notNull(),
		updatedBy: text('updated_by').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('tax_corporation_exclusions_updated_at_idx').on(table.updatedAt)]
)

/**
 * Managed corporations (owned by core domain).
 * Read-only in tax domain; used for authoritative corporation scope resolution.
 */
export const managedCorporations = pgTable(
	'managed_corporations',
	{
		corporationId: text('corporation_id').primaryKey(),
		name: varchar('name', { length: 255 }).notNull(),
		isActive: boolean('is_active').default(true).notNull(),
		isMemberCorporation: boolean('is_member_corporation').default(false).notNull(),
		isSpecialPurpose: boolean('is_special_purpose').default(false).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('managed_corporations_is_active_idx').on(table.isActive),
		index('managed_corporations_corporation_id_is_member_idx').on(
			table.corporationId,
			table.isMemberCorporation
		),
		index('managed_corporations_corporation_id_is_special_purpose_idx').on(
			table.corporationId,
			table.isSpecialPurpose
		),
	]
)

/**
 * Corporation-level billing configuration for issuing assessment bills.
 */
export const taxCorporationBillingConfigs = pgTable(
	'tax_corporation_billing_configs',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		isDefault: boolean('is_default').notNull().default(false),
		billingEnabled: boolean('billing_enabled').notNull().default(false),
		billingIssuerUserId: text('billing_issuer_user_id').notNull().default(''),
		billingPayeeId: text('billing_payee_id').notNull().default(''),
		billingPayeeType: text('billing_payee_type').notNull().default(''),
		billingDueDays: integer('billing_due_days').notNull().default(14),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_corporation_billing_configs_corporation_id_idx').on(table.corporationId),
		index('tax_corporation_billing_configs_updated_at_idx').on(table.updatedAt),
		uniqueIndex('tax_corporation_billing_configs_one_default_per_corp')
			.on(table.corporationId)
			.where(sql`${table.isDefault} = true`),
		unique('tax_corporation_billing_configs_payee_tuple_unique').on(
			table.corporationId,
			table.billingPayeeType,
			table.billingPayeeId
		),
	]
)

export const taxAssessmentScopeEnum = pgEnum('tax_assessment_scope', [
	'corporation',
	'division',
	'character',
])
export const taxAssessmentStatusEnum = pgEnum('tax_assessment_status', [
	'draft',
	'underpaid',
	'paid',
	'overpaid',
	'excluded',
])
export const taxPeriodStatusEnum = pgEnum('tax_period_status', ['open', 'assessed', 'closed'])
export const taxBillStatusEnum = pgEnum('tax_bill_status', [
	'draft',
	'issued',
	'paid',
	'cancelled',
	'overdue',
])
export const taxExportFormatEnum = pgEnum('tax_export_format', ['csv', 'xlsx'])
export const taxExportStatusEnum = pgEnum('tax_export_status', [
	'queued',
	'running',
	'completed',
	'failed',
])
export const taxExportFrequencyEnum = pgEnum('tax_export_frequency', ['weekly', 'monthly'])
export const taxAlertSeverityEnum = pgEnum('tax_alert_severity', ['critical', 'warning', 'info'])
export const taxAlertStatusEnum = pgEnum('tax_alert_status', ['open', 'acknowledged', 'resolved'])
export const taxAlertDiscordDeliveryStatusEnum = pgEnum('tax_alert_discord_delivery_status', [
	'pending',
	'sent',
	'failed',
	'skipped',
])

/**
 * Audit records for tax configuration and administrative actions.
 */
export const taxAuditLog = pgTable(
	'tax_audit_log',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id'),
		actorUserId: text('actor_user_id').notNull(),
		action: text('action').notNull(),
		before: jsonb('before').$type<Record<string, unknown> | null>(),
		after: jsonb('after').$type<Record<string, unknown> | null>(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_audit_log_corporation_id_idx').on(table.corporationId),
		index('tax_audit_log_created_at_idx').on(table.createdAt),
	]
)

export const taxAssessments = pgTable(
	'tax_assessments',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		taxPeriodStart: timestamp('tax_period_start', { withTimezone: true }).notNull(),
		taxPeriodEnd: timestamp('tax_period_end', { withTimezone: true }).notNull(),
		assessmentScope: taxAssessmentScopeEnum('assessment_scope').notNull().default('corporation'),
		scopeId: text('scope_id').notNull(),
		taxableIncome: text('taxable_income').notNull().default('0'),
		nonTaxableIncome: text('non_taxable_income').notNull().default('0'),
		taxDue: text('tax_due').notNull().default('0'),
		taxPaid: text('tax_paid').notNull().default('0'),
		taxDelta: text('tax_delta').notNull().default('0'),
		status: taxAssessmentStatusEnum('status').notNull().default('draft'),
		inGameTaxRateBps: integer('in_game_tax_rate_bps'),
		portalTaxRateBps: integer('portal_tax_rate_bps').notNull().default(0),
		billId: uuid('bill_id'),
		billStatus: taxBillStatusEnum('bill_status'),
		billStatusLastSyncedAt: timestamp('bill_status_last_synced_at', { withTimezone: true }),
		approvedBy: text('approved_by'),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_assessments_scope_period_unique').on(
			table.corporationId,
			table.taxPeriodStart,
			table.taxPeriodEnd,
			table.assessmentScope,
			table.scopeId
		),
		index('tax_assessments_corporation_id_idx').on(table.corporationId),
		index('tax_assessments_status_idx').on(table.status),
		index('tax_assessments_scope_idx').on(table.assessmentScope),
		index('tax_assessments_period_start_idx').on(table.taxPeriodStart),
		index('tax_assessments_period_end_idx').on(table.taxPeriodEnd),
		index('tax_assessments_bill_id_idx').on(table.billId),
	]
)

export const taxPeriods = pgTable(
	'tax_periods',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
		periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
		status: taxPeriodStatusEnum('status').notNull().default('open'),
		closedAt: timestamp('closed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_periods_corp_period_unique').on(
			table.corporationId,
			table.periodStart,
			table.periodEnd
		),
		index('tax_periods_corporation_id_idx').on(table.corporationId),
		index('tax_periods_period_start_idx').on(table.periodStart),
		index('tax_periods_period_end_idx').on(table.periodEnd),
		index('tax_periods_status_idx').on(table.status),
	]
)

export const taxAssessmentLines = pgTable(
	'tax_assessment_lines',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		assessmentId: uuid('assessment_id')
			.notNull()
			.references(() => taxAssessments.id, { onDelete: 'cascade' }),
		ledgerEntryId: uuid('ledger_entry_id').notNull(),
		appliedRuleSetId: uuid('applied_rule_set_id'),
		taxRateBps: integer('tax_rate_bps').notNull().default(0),
		taxableAmount: text('taxable_amount').notNull().default('0'),
		taxAmount: text('tax_amount').notNull().default('0'),
		classification: text('classification').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_assessment_lines_assessment_ledger_unique').on(
			table.assessmentId,
			table.ledgerEntryId
		),
		index('tax_assessment_lines_assessment_id_idx').on(table.assessmentId),
		index('tax_assessment_lines_ledger_entry_id_idx').on(table.ledgerEntryId),
		index('tax_assessment_lines_applied_rule_set_id_idx').on(table.appliedRuleSetId),
	]
)

export const taxDiscrepancies = pgTable(
	'tax_discrepancies',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		assessmentId: uuid('assessment_id').references(() => taxAssessments.id, {
			onDelete: 'set null',
		}),
		discrepancyType: text('discrepancy_type').notNull(),
		severity: text('severity').notNull(),
		details: jsonb('details').$type<Record<string, unknown> | null>(),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_discrepancies_corporation_id_idx').on(table.corporationId),
		index('tax_discrepancies_assessment_id_idx').on(table.assessmentId),
		index('tax_discrepancies_discrepancy_type_idx').on(table.discrepancyType),
		index('tax_discrepancies_severity_idx').on(table.severity),
	]
)

export const taxBillSyncEvents = pgTable(
	'tax_bill_sync_events',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		assessmentId: uuid('assessment_id')
			.notNull()
			.references(() => taxAssessments.id, { onDelete: 'cascade' }),
		billId: uuid('bill_id').notNull(),
		eventType: text('event_type').notNull(),
		fromStatus: text('from_status'),
		toStatus: text('to_status'),
		payload: jsonb('payload').$type<Record<string, string | number | boolean | null> | null>(),
		syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_bill_sync_events_corporation_id_idx').on(table.corporationId),
		index('tax_bill_sync_events_assessment_id_idx').on(table.assessmentId),
		index('tax_bill_sync_events_bill_id_idx').on(table.billId),
		index('tax_bill_sync_events_synced_at_idx').on(table.syncedAt),
	]
)

export const taxExports = pgTable(
	'tax_exports',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id'),
		requestedByUserId: text('requested_by_user_id').notNull(),
		format: taxExportFormatEnum('format').notNull(),
		reportType: text('report_type').notNull(),
		status: taxExportStatusEnum('status').notNull().default('queued'),
		filters: jsonb('filters').$type<Record<string, unknown> | null>(),
		rowCount: integer('row_count'),
		sourceEsiVersion: text('source_esi_version'),
		error: text('error'),
		requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_exports_corporation_id_idx').on(table.corporationId),
		index('tax_exports_requested_by_idx').on(table.requestedByUserId),
		index('tax_exports_status_idx').on(table.status),
		index('tax_exports_requested_at_idx').on(table.requestedAt),
	]
)

export const taxExportSchedules = pgTable(
	'tax_export_schedules',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		corporationId: text('corporation_id'),
		createdByUserId: text('created_by_user_id').notNull(),
		format: taxExportFormatEnum('format').notNull(),
		frequency: taxExportFrequencyEnum('frequency').notNull(),
		reportType: text('report_type').notNull(),
		filters: jsonb('filters').$type<Record<string, unknown> | null>(),
		isActive: boolean('is_active').notNull().default(true),
		nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
		lastRunAt: timestamp('last_run_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_export_schedules_corporation_id_idx').on(table.corporationId),
		index('tax_export_schedules_created_by_idx').on(table.createdByUserId),
		index('tax_export_schedules_is_active_idx').on(table.isActive),
		index('tax_export_schedules_next_run_at_idx').on(table.nextRunAt),
	]
)

export const taxNotificationDestinations = pgTable(
	'tax_notification_destinations',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		guildId: text('guild_id').notNull(),
		channelId: text('channel_id').notNull(),
		createdByUserId: text('created_by_user_id').notNull(),
		updatedByUserId: text('updated_by_user_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('tax_notification_destinations_updated_at_idx').on(table.updatedAt)]
)

export const taxAlerts = pgTable(
	'tax_alerts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id'),
		alertType: text('alert_type').notNull(),
		severity: taxAlertSeverityEnum('severity').notNull(),
		status: taxAlertStatusEnum('status').notNull().default('open'),
		dedupeKey: text('dedupe_key').notNull(),
		payload: jsonb('payload').$type<Record<string, unknown> | null>(),
		firstTriggeredAt: timestamp('first_triggered_at', { withTimezone: true })
			.defaultNow()
			.notNull(),
		lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }).defaultNow().notNull(),
		acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
		acknowledgedByUserId: text('acknowledged_by_user_id'),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolvedByUserId: text('resolved_by_user_id'),
		discordDeliveryStatus: taxAlertDiscordDeliveryStatusEnum('discord_delivery_status')
			.notNull()
			.default('pending'),
		discordAttemptCount: integer('discord_attempt_count').notNull().default(0),
		discordLastAttemptAt: timestamp('discord_last_attempt_at', { withTimezone: true }),
		discordLastError: text('discord_last_error'),
		nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_alerts_dedupe_key_unique').on(table.dedupeKey),
		index('tax_alerts_corporation_id_idx').on(table.corporationId),
		index('tax_alerts_status_idx').on(table.status),
		index('tax_alerts_severity_idx').on(table.severity),
		index('tax_alerts_last_triggered_at_idx').on(table.lastTriggeredAt),
		index('tax_alerts_discord_delivery_status_idx').on(table.discordDeliveryStatus),
	]
)

export const taxLedgerEntries = pgTable(
	'tax_ledger_entries',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		sourceType: text('source_type').notNull(),
		sourcePrimaryId: text('source_primary_id').notNull(),
		sourceSecondaryId: text('source_secondary_id'),
		sourceKey: text('source_key').notNull(),
		division: integer('division'),
		refType: text('ref_type').notNull(),
		amount: text('amount').notNull(),
		balance: text('balance'),
		direction: text('direction').notNull(),
		firstPartyId: text('first_party_id'),
		secondPartyId: text('second_party_id'),
		entryDate: timestamp('entry_date', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_ledger_entries_source_key_unique').on(table.sourceKey),
		index('tax_ledger_entries_corporation_id_idx').on(table.corporationId),
		index('tax_ledger_entries_ref_type_idx').on(table.refType),
		index('tax_ledger_entries_entry_date_idx').on(table.entryDate),
	]
)

export const taxSyncCheckpoints = pgTable(
	'tax_sync_checkpoints',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		sourceType: text('source_type').notNull(),
		cursor: text('cursor'),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
		lastError: text('last_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_sync_checkpoints_corp_source_unique').on(table.corporationId, table.sourceType),
		index('tax_sync_checkpoints_corporation_id_idx').on(table.corporationId),
		index('tax_sync_checkpoints_source_type_idx').on(table.sourceType),
		index('tax_sync_checkpoints_last_successful_sync_at_idx').on(table.lastSuccessfulSyncAt),
	]
)

export const taxDailyRollups = pgTable(
	'tax_daily_rollups',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		rollupDate: date('rollup_date', { mode: 'date' }).notNull(),
		division: integer('division'),
		refType: text('ref_type'),
		taxableIncome: text('taxable_income').notNull().default('0'),
		taxDue: text('tax_due').notNull().default('0'),
		taxPaid: text('tax_paid').notNull().default('0'),
		essIncome: text('ess_income').notNull().default('0'),
		entryCount: integer('entry_count').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_daily_rollups_corp_date_division_ref_unique').on(
			table.corporationId,
			table.rollupDate,
			table.division,
			table.refType
		),
		index('tax_daily_rollups_corporation_id_idx').on(table.corporationId),
		index('tax_daily_rollups_rollup_date_idx').on(table.rollupDate),
		index('tax_daily_rollups_ref_type_idx').on(table.refType),
	]
)

/**
 * Incremental projection rollups for member contribution summaries.
 * Mutable during open/inter-period windows and refreshed after ingest updates.
 */
export const taxMemberContributionProjectionRollups = pgTable(
	'tax_member_contribution_projection_rollups',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
		periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
		rollupDate: date('rollup_date', { mode: 'date' }).notNull(),
		characterId: text('character_id').notNull(),
		refType: text('ref_type').notNull(),
		contributionIncome: text('contribution_income').notNull().default('0'),
		taxableContributionIncome: text('taxable_contribution_income').notNull().default('0'),
		assessmentCount: integer('assessment_count').notNull().default(0),
		sourceRowCount: integer('source_row_count').notNull().default(0),
		lastAssessmentAt: timestamp('last_assessment_at', { withTimezone: true }),
		lastLedgerEntryDate: timestamp('last_ledger_entry_date', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_member_proj_rollups_unique').on(
			table.corporationId,
			table.periodStart,
			table.periodEnd,
			table.rollupDate,
			table.characterId,
			table.refType
		),
		index('tax_member_proj_rollups_corp_period_idx').on(
			table.corporationId,
			table.periodStart,
			table.periodEnd
		),
		index('tax_member_proj_rollups_corp_char_period_idx').on(
			table.corporationId,
			table.characterId,
			table.periodStart,
			table.periodEnd
		),
		index('tax_member_proj_rollups_corp_ref_rollup_date_idx').on(
			table.corporationId,
			table.refType,
			table.rollupDate
		),
	]
)

/**
 * Immutable finalized rollups for closed periods derived from formal assessments.
 */
export const taxMemberContributionFinalizedRollups = pgTable(
	'tax_member_contribution_finalized_rollups',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		corporationId: text('corporation_id').notNull(),
		periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
		periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
		rollupDate: date('rollup_date', { mode: 'date' }).notNull(),
		characterId: text('character_id').notNull(),
		refType: text('ref_type').notNull(),
		contributionIncome: text('contribution_income').notNull().default('0'),
		taxableContributionIncome: text('taxable_contribution_income').notNull().default('0'),
		assessmentCount: integer('assessment_count').notNull().default(0),
		sourceRowCount: integer('source_row_count').notNull().default(0),
		finalizedAssessmentId: uuid('finalized_assessment_id').references(() => taxAssessments.id, {
			onDelete: 'set null',
		}),
		lastAssessmentAt: timestamp('last_assessment_at', { withTimezone: true }),
		lastLedgerEntryDate: timestamp('last_ledger_entry_date', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_member_final_rollups_unique').on(
			table.corporationId,
			table.periodStart,
			table.periodEnd,
			table.rollupDate,
			table.characterId,
			table.refType
		),
		index('tax_member_final_rollups_corp_period_idx').on(
			table.corporationId,
			table.periodStart,
			table.periodEnd
		),
		index('tax_member_final_rollups_corp_char_period_idx').on(
			table.corporationId,
			table.characterId,
			table.periodStart,
			table.periodEnd
		),
		index('tax_member_final_rollups_corp_ref_rollup_date_idx').on(
			table.corporationId,
			table.refType,
			table.rollupDate
		),
		index('tax_member_final_rollups_assessment_id_idx').on(table.finalizedAssessmentId),
	]
)

/**
 * Watermarks used to validate cache freshness for member summary reads.
 */
export const taxMemberSummaryVersions = pgTable(
	'tax_member_summary_versions',
	{
		corporationId: text('corporation_id').primaryKey(),
		projectionVersion: integer('projection_version').notNull().default(0),
		finalizedVersion: integer('finalized_version').notNull().default(0),
		projectionUpdatedAt: timestamp('projection_updated_at', { withTimezone: true }),
		finalizedUpdatedAt: timestamp('finalized_updated_at', { withTimezone: true }),
		ruleMembershipMutatedAt: timestamp('rule_membership_mutated_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [index('tax_member_summary_versions_updated_at_idx').on(table.updatedAt)]
)

export const taxRuleGroups = pgTable(
	'tax_rule_groups',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		description: text('description'),
		isDefaultGlobal: boolean('is_default_global').notNull().default(false),
		isSystem: boolean('is_system').notNull().default(false),
		createdBy: text('created_by').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_rule_groups_default_global_idx').on(table.isDefaultGlobal),
		index('tax_rule_groups_name_idx').on(table.name),
	]
)

export const taxRuleGroupAttachments = pgTable(
	'tax_rule_group_attachments',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		ruleGroupId: uuid('rule_group_id')
			.notNull()
			.references(() => taxRuleGroups.id, { onDelete: 'cascade' }),
		corporationId: text('corporation_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		unique('tax_rule_group_attachments_unique').on(table.ruleGroupId, table.corporationId),
		index('tax_rule_group_attachments_corporation_id_idx').on(table.corporationId),
	]
)

export const taxRuleSets = pgTable(
	'tax_rule_sets',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		ruleGroupId: uuid('rule_group_id')
			.notNull()
			.references(() => taxRuleGroups.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		priority: integer('priority').notNull().default(0),
		isActive: boolean('is_active').notNull().default(true),
		appliesToRefType: text('applies_to_ref_type'),
		taxRateBps: integer('tax_rate_bps').notNull().default(0),
		createdBy: text('created_by').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('tax_rule_sets_rule_group_id_idx').on(table.ruleGroupId),
		index('tax_rule_sets_is_active_idx').on(table.isActive),
		index('tax_rule_sets_priority_idx').on(table.priority),
		index('tax_rule_sets_ref_type_idx').on(table.appliesToRefType),
	]
)

export const taxRuleGroupsRelations = relations(taxRuleGroups, ({ many }) => ({
	ruleSets: many(taxRuleSets),
	attachments: many(taxRuleGroupAttachments),
}))

export const taxRuleGroupAttachmentsRelations = relations(taxRuleGroupAttachments, ({ one }) => ({
	ruleGroup: one(taxRuleGroups, {
		fields: [taxRuleGroupAttachments.ruleGroupId],
		references: [taxRuleGroups.id],
	}),
}))

export const taxRuleSetsRelations = relations(taxRuleSets, ({ one }) => ({
	ruleGroup: one(taxRuleGroups, {
		fields: [taxRuleSets.ruleGroupId],
		references: [taxRuleGroups.id],
	}),
}))

export const taxAssessmentsRelations = relations(taxAssessments, ({ many }) => ({
	billSyncEvents: many(taxBillSyncEvents),
	lines: many(taxAssessmentLines),
	discrepancies: many(taxDiscrepancies),
}))

export const taxBillSyncEventsRelations = relations(taxBillSyncEvents, ({ one }) => ({
	assessment: one(taxAssessments, {
		fields: [taxBillSyncEvents.assessmentId],
		references: [taxAssessments.id],
	}),
}))

export const taxAssessmentLinesRelations = relations(taxAssessmentLines, ({ one }) => ({
	assessment: one(taxAssessments, {
		fields: [taxAssessmentLines.assessmentId],
		references: [taxAssessments.id],
	}),
	ledgerEntry: one(taxLedgerEntries, {
		fields: [taxAssessmentLines.ledgerEntryId],
		references: [taxLedgerEntries.id],
	}),
	ruleSet: one(taxRuleSets, {
		fields: [taxAssessmentLines.appliedRuleSetId],
		references: [taxRuleSets.id],
	}),
}))

export const taxDiscrepanciesRelations = relations(taxDiscrepancies, ({ one }) => ({
	assessment: one(taxAssessments, {
		fields: [taxDiscrepancies.assessmentId],
		references: [taxAssessments.id],
	}),
}))

export const schema = {
	taxCorporationExclusions,
	taxCorporationBillingConfigs,
	taxAuditLog,
	taxAssessments,
	taxPeriods,
	taxAssessmentLines,
	taxDiscrepancies,
	taxBillSyncEvents,
	taxExports,
	taxExportSchedules,
	taxNotificationDestinations,
	taxAlerts,
	taxLedgerEntries,
	taxSyncCheckpoints,
	taxDailyRollups,
	taxMemberContributionProjectionRollups,
	taxMemberContributionFinalizedRollups,
	taxMemberSummaryVersions,
	taxRuleGroups,
	taxRuleGroupAttachments,
	taxRuleSets,
	taxAssessmentsRelations,
	taxBillSyncEventsRelations,
	taxAssessmentLinesRelations,
	taxDiscrepanciesRelations,
	taxRuleGroupsRelations,
	taxRuleGroupAttachmentsRelations,
	taxRuleSetsRelations,
}
