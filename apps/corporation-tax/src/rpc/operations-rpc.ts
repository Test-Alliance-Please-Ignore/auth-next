import { and, eq } from '@repo/db-utils'

import { managedCorporations, taxAssessments, taxCorporationExclusions, taxRuleGroupAttachments } from '../db/schema'

import type {
	CreateTaxExportScheduleInput,
	ListTaxAlertsFilters,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	ListTaxNotificationDestinationsFilters,
	RequestTaxExportInput,
	RunTaxAssessmentForPeriodInput,
	RunTaxAssessmentForPeriodResult,
	TaxAlert,
	TaxExportArtifact,
	TaxExportRecord,
	TaxExportSchedule,
	TaxNotificationDestination,
	TaxScheduledOperationsResult,
	TriggerTaxAlertInput,
	TriggerTaxProjectionRefreshInput,
	TriggerTaxProjectionRefreshResult,
	UpsertTaxNotificationDestinationInput,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'
import type { TaxAlertService } from '../services/tax-alert.service'
import type { TaxAuditService } from '../services/tax-audit.service'
import type { TaxExportService } from '../services/tax-export.service'
import type { TaxLedgerService } from '../services/tax-ledger.service'

const LEDGER_RETENTION_DAYS = 90
const SCHEDULED_CORPORATION_CONCURRENCY = 5

type OperationsRpcContext = {
	db: CorporationTaxDb
	ledgerService: TaxLedgerService
	exportService: TaxExportService
	alertService: TaxAlertService
	auditService: TaxAuditService
	listProcessableCorporationIds: () => Promise<string[]>
	shouldRunDailyIngest: (corporationId: string, asOf: Date) => Promise<boolean>
	triggerProjectionRefreshFromWalletSync: (
		actorUserId: string,
		input: TriggerTaxProjectionRefreshInput
	) => Promise<TriggerTaxProjectionRefreshResult>
	buildScheduledProjectionRefreshInput: (
		corporationId: string,
		runAt: Date
	) => TriggerTaxProjectionRefreshInput
	runAssessmentForPeriod: (
		actorUserId: string,
		input: RunTaxAssessmentForPeriodInput
	) => Promise<RunTaxAssessmentForPeriodResult>
	triggerSchedulerOperationFailureAlert: (input: {
		actorUserId: string
		corporationId: string
		operation: 'daily_ingest' | 'monthly_assessment' | 'ledger_retention'
		asOf: Date
		error: unknown
	}) => Promise<void>
	triggerScheduledExportFailureAlerts: (
		actorUserId: string,
		asOf: Date,
		failures: Array<{ scheduleId: string; corporationId: string | null; error: string }>
	) => Promise<void>
	triggerCorporationCoverageAlerts: (actorUserId: string, corporationId: string) => Promise<void>
	getPreviousMonthWindow: (asOf: Date) => { periodStart: Date; periodEnd: Date }
	runWithConcurrency: <T>(
		items: readonly T[],
		concurrency: number,
		worker: (item: T) => Promise<void>
	) => Promise<void>
}

export class TaxOperationsRpc {
	constructor(private readonly ctx: OperationsRpcContext) {}

	async requestExport(actorUserId: string, input: RequestTaxExportInput): Promise<TaxExportRecord> {
		const created = await this.ctx.exportService.requestExport(actorUserId, input)
		await this.ctx.auditService.logAction({
			corporationId: created.corporationId ?? undefined,
			actorUserId,
			action: 'tax.export.requested',
			before: null,
			after: {
				exportId: created.id,
				reportType: created.reportType,
				format: created.format,
				status: created.status,
				rowCount: created.rowCount,
			},
		})
		return created
	}

	listExports(filters?: ListTaxExportsFilters): Promise<TaxExportRecord[]> {
		return this.ctx.exportService.listExports(filters)
	}

	getExportById(exportId: string): Promise<TaxExportRecord | null> {
		return this.ctx.exportService.getExportById(exportId)
	}

	getExportArtifact(exportId: string): Promise<TaxExportArtifact> {
		return this.ctx.exportService.getExportArtifact(exportId)
	}

	async createExportSchedule(
		actorUserId: string,
		input: CreateTaxExportScheduleInput
	): Promise<TaxExportSchedule> {
		const schedule = await this.ctx.exportService.createExportSchedule(actorUserId, input)
		await this.ctx.auditService.logAction({
			corporationId: schedule.corporationId ?? undefined,
			actorUserId,
			action: 'tax.export.schedule.created',
			before: null,
			after: {
				scheduleId: schedule.id,
				name: schedule.name,
				frequency: schedule.frequency,
				reportType: schedule.reportType,
				format: schedule.format,
				isActive: schedule.isActive,
				nextRunAt: schedule.nextRunAt.toISOString(),
			},
		})
		return schedule
	}

	listExportSchedules(filters?: ListTaxExportSchedulesFilters): Promise<TaxExportSchedule[]> {
		return this.ctx.exportService.listExportSchedules(filters)
	}

	async runScheduledOperations(
		actorUserId: string,
		asOf?: Date,
		exportScheduleLimit?: number,
		alertRetryLimit?: number
	): Promise<TaxScheduledOperationsResult> {
		const runAt = asOf ?? new Date()
		const processingCorporationIds = await this.ctx.listProcessableCorporationIds()
		let dailyIngestCorporationsProcessed = 0
		let dailyIngestFailures = 0
		let monthlyAssessmentCorporationsProcessed = 0
		let monthlyAssessmentFailures = 0
		let ledgerRetentionCorporationsProcessed = 0
		let ledgerRetentionFailures = 0
		let ledgerRetentionEntriesDeleted = 0
		const previousMonthWindow = this.ctx.getPreviousMonthWindow(runAt)

		await this.ctx.runWithConcurrency(
			processingCorporationIds,
			SCHEDULED_CORPORATION_CONCURRENCY,
			async (corporationId) => {
				await this.ctx.triggerCorporationCoverageAlerts(actorUserId, corporationId)
				const shouldIngest = await this.ctx.shouldRunDailyIngest(corporationId, runAt)
				if (shouldIngest) {
					try {
						await this.ctx.triggerProjectionRefreshFromWalletSync(
							actorUserId,
							this.ctx.buildScheduledProjectionRefreshInput(corporationId, runAt)
						)
						dailyIngestCorporationsProcessed += 1
					} catch (error) {
						dailyIngestFailures += 1
						await this.ctx.triggerSchedulerOperationFailureAlert({
							actorUserId,
							corporationId,
							operation: 'daily_ingest',
							asOf: runAt,
							error,
						})
					}
				}

				try {
					const existingMonthlyAssessment = await this.ctx.db.query.taxAssessments.findFirst({
						where: and(
							eq(taxAssessments.corporationId, corporationId),
							eq(taxAssessments.assessmentScope, 'corporation'),
							eq(taxAssessments.taxPeriodStart, previousMonthWindow.periodStart),
							eq(taxAssessments.taxPeriodEnd, previousMonthWindow.periodEnd)
						),
						columns: { id: true },
					})

					if (!existingMonthlyAssessment) {
						await this.ctx.runAssessmentForPeriod(actorUserId, {
							corporationId,
							periodStart: previousMonthWindow.periodStart,
							periodEnd: previousMonthWindow.periodEnd,
							includeCharacterWallets: false,
						})
						monthlyAssessmentCorporationsProcessed += 1
					}
				} catch (error) {
					monthlyAssessmentFailures += 1
					await this.ctx.triggerSchedulerOperationFailureAlert({
						actorUserId,
						corporationId,
						operation: 'monthly_assessment',
						asOf: runAt,
						error,
					})
				}

				try {
					const retentionResult = await this.ctx.ledgerService.trimLedgerEntries(
						corporationId,
						LEDGER_RETENTION_DAYS
					)
					ledgerRetentionCorporationsProcessed += 1
					ledgerRetentionEntriesDeleted += retentionResult.deletedEntryCount
				} catch (error) {
					ledgerRetentionFailures += 1
					await this.ctx.triggerSchedulerOperationFailureAlert({
						actorUserId,
						corporationId,
						operation: 'ledger_retention',
						asOf: runAt,
						error,
					})
				}
			}
		)

		const exportScheduleResult = await this.ctx.exportService.runDueExportSchedules(
			runAt,
			exportScheduleLimit
		)
		const dueExportSchedulesProcessed = exportScheduleResult.processed
		await this.ctx.triggerScheduledExportFailureAlerts(
			actorUserId,
			runAt,
			exportScheduleResult.failures
		)
		const failedAlertDeliveriesRetried = await this.ctx.alertService.retryFailedAlertDeliveries(
			actorUserId,
			alertRetryLimit
		)

		await this.ctx.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.scheduled.operations.run',
			before: null,
			after: {
				asOf: runAt.toISOString(),
				includedCorporationCount: processingCorporationIds.length,
				dailyIngestCorporationsProcessed,
				dailyIngestFailures,
				monthlyAssessmentCorporationsProcessed,
				monthlyAssessmentFailures,
				ledgerRetentionCorporationsProcessed,
				ledgerRetentionFailures,
				ledgerRetentionEntriesDeleted,
				dueExportSchedulesProcessed,
				dueExportScheduleFailures: exportScheduleResult.failures.length,
				failedAlertDeliveriesRetried,
			},
		})

		return {
			asOf: runAt,
			includedCorporationCount: processingCorporationIds.length,
			dailyIngestCorporationsProcessed,
			dailyIngestFailures,
			monthlyAssessmentCorporationsProcessed,
			monthlyAssessmentFailures,
			ledgerRetentionCorporationsProcessed,
			ledgerRetentionFailures,
			ledgerRetentionEntriesDeleted,
			dueExportSchedulesProcessed,
			failedAlertDeliveriesRetried,
		}
	}

	async triggerAlert(actorUserId: string, input: TriggerTaxAlertInput): Promise<TaxAlert> {
		const alert = await this.ctx.alertService.triggerAlert(actorUserId, input)
		await this.ctx.auditService.logAction({
			corporationId: alert.corporationId ?? undefined,
			actorUserId,
			action: 'tax.alert.triggered',
			before: null,
			after: {
				alertId: alert.id,
				alertType: alert.alertType,
				severity: alert.severity,
				status: alert.status,
				dedupeKey: alert.dedupeKey,
			},
		})
		return alert
	}

	listAlerts(filters?: ListTaxAlertsFilters): Promise<TaxAlert[]> {
		return this.ctx.alertService.listAlerts(filters)
	}

	async acknowledgeAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		const alert = await this.ctx.alertService.acknowledgeAlert(actorUserId, alertId)
		await this.ctx.auditService.logAction({
			corporationId: alert.corporationId ?? undefined,
			actorUserId,
			action: 'tax.alert.acknowledged',
			before: null,
			after: { alertId: alert.id },
		})
		return alert
	}

	async resolveAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		const alert = await this.ctx.alertService.resolveAlert(actorUserId, alertId)
		await this.ctx.auditService.logAction({
			corporationId: alert.corporationId ?? undefined,
			actorUserId,
			action: 'tax.alert.resolved',
			before: null,
			after: { alertId: alert.id },
		})
		return alert
	}

	async retryFailedAlertDeliveries(actorUserId: string, limit?: number): Promise<number> {
		const retried = await this.ctx.alertService.retryFailedAlertDeliveries(actorUserId, limit)
		await this.ctx.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.alert.retry_failed_deliveries',
			before: null,
			after: { retried },
		})
		return retried
	}

	async upsertNotificationDestination(
		actorUserId: string,
		input: UpsertTaxNotificationDestinationInput
	): Promise<TaxNotificationDestination> {
		const destination = await this.ctx.alertService.upsertNotificationDestination(actorUserId, input)
		await this.ctx.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.notification_destination.upserted',
			before: null,
			after: {
				destinationId: destination.id,
				name: destination.name,
				guildId: destination.guildId,
				channelId: destination.channelId,
			},
		})
		return destination
	}

	listNotificationDestinations(
		filters?: ListTaxNotificationDestinationsFilters
	): Promise<TaxNotificationDestination[]> {
		return this.ctx.alertService.listNotificationDestinations(filters)
	}
}
