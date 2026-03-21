import { and, asc, desc, eq, lte } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { taxExports, taxExportSchedules } from '../db/schema'

import type {
	CreateTaxExportScheduleInput,
	ListTaxExportSchedulesFilters,
	ListTaxExportsFilters,
	RequestTaxExportInput,
	TaxExportArtifact,
	TaxExportRecord,
	TaxExportReportType,
	TaxExportSchedule,
	TaxReportWindowFilters,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'
import type { TaxReportService } from './tax-report.service'

export class TaxExportService {
	constructor(
		private db: CorporationTaxDb,
		private reportService: TaxReportService
	) {}

	async requestExport(actorUserId: string, input: RequestTaxExportInput): Promise<TaxExportRecord> {
		const normalizedFilters = this.normalizeJson(input.filters ?? null)

		const [created] = await this.db
			.insert(taxExports)
			.values({
				corporationId: input.corporationId ?? null,
				requestedByUserId: actorUserId,
				format: input.format,
				reportType: input.reportType,
				status: 'running',
				filters: normalizedFilters,
				sourceEsiVersion: input.sourceEsiVersion ?? 'esi-v1',
				requestedAt: new Date(),
			})
			.returning()

		if (!created) {
			throw new Error('Failed to create export record')
		}

		try {
			const rowCount = await this.computeExportRowCount(input)
			const [completed] = await this.db
				.update(taxExports)
				.set({
					status: 'completed',
					rowCount,
					completedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(taxExports.id, created.id))
				.returning()

			return this.toExportRecord(completed ?? created)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const [failed] = await this.db
				.update(taxExports)
				.set({
					status: 'failed',
					error: message,
					completedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(taxExports.id, created.id))
				.returning()

			return this.toExportRecord(failed ?? created)
		}
	}

	async listExports(filters: ListTaxExportsFilters = {}): Promise<TaxExportRecord[]> {
		const conditions = []
		if (filters.corporationId) {
			conditions.push(eq(taxExports.corporationId, filters.corporationId))
		}
		if (filters.format) {
			conditions.push(eq(taxExports.format, filters.format))
		}
		if (filters.status) {
			conditions.push(eq(taxExports.status, filters.status))
		}

		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const rows = await this.db.query.taxExports.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(taxExports.requestedAt)],
			limit,
			offset,
		})

		return rows.map((row) => this.toExportRecord(row))
	}

	async getExportById(exportId: string): Promise<TaxExportRecord | null> {
		const row = await this.db.query.taxExports.findFirst({
			where: eq(taxExports.id, exportId),
		})
		return row ? this.toExportRecord(row) : null
	}

	async getExportArtifact(exportId: string): Promise<TaxExportArtifact> {
		const record = await this.db.query.taxExports.findFirst({
			where: eq(taxExports.id, exportId),
		})

		if (!record) {
			throw new Error('Export not found')
		}
		if (record.status !== 'completed') {
			throw new Error('Export artifact is only available for completed exports')
		}

		const reportRows = await this.getReportRows({
			reportType: record.reportType as TaxExportReportType,
			corporationId: record.corporationId ?? undefined,
			filters: record.filters,
		})
		const generatedAt = new Date()
		const dateStamp = generatedAt.toISOString().slice(0, 10)
		const requestedFormat = record.format
		const metadataCsv = this.toMetadataCsv({
			generatedAt,
			sourceEsiVersion: record.sourceEsiVersion,
			filters: record.filters,
		})
		const dataCsv = this.toCsv(reportRows)
		const csv = `${metadataCsv}\n\n${dataCsv}`

		// We currently deliver CSV content for both formats to avoid introducing XLSX dependencies.
		const deliveredFormat = 'csv' as const
		const fileName = `tax-${record.reportType}-${dateStamp}.csv`
		const note =
			requestedFormat === 'xlsx'
				? 'Requested XLSX; delivered CSV fallback because XLSX generation is not configured.'
				: null

		return {
			exportId: record.id,
			corporationId: record.corporationId,
			reportType: record.reportType as TaxExportReportType,
			requestedFormat,
			deliveredFormat,
			fileName,
			contentType: 'text/csv; charset=utf-8',
			contentBase64: this.toBase64Utf8(csv),
			rowCount: reportRows.length,
			generatedAt,
			note,
		}
	}

	private toMetadataCsv(input: {
		generatedAt: Date
		sourceEsiVersion: string | null
		filters: Record<string, unknown> | null
	}): string {
		const lines: string[] = []
		const rows: Array<[string, unknown]> = [
			['generated_at', input.generatedAt.toISOString()],
			['source_esi_version', input.sourceEsiVersion ?? ''],
			['applied_filters', input.filters ?? {}],
		]
		for (const [key, value] of rows) {
			lines.push(`${this.escapeCsvValue(key)},${this.escapeCsvValue(value)}`)
		}
		return lines.join('\n')
	}

	async createExportSchedule(
		actorUserId: string,
		input: CreateTaxExportScheduleInput
	): Promise<TaxExportSchedule> {
		const [created] = await this.db
			.insert(taxExportSchedules)
			.values({
				name: input.name,
				corporationId: input.corporationId ?? null,
				createdByUserId: actorUserId,
				format: input.format,
				frequency: input.frequency,
				reportType: input.reportType,
				filters: this.normalizeJson(input.filters ?? null),
				isActive: input.isActive ?? true,
				nextRunAt: input.nextRunAt ?? this.computeNextRunAt(input.frequency, new Date()),
			})
			.returning()

		if (!created) {
			throw new Error('Failed to create export schedule')
		}

		return this.toExportSchedule(created)
	}

	async listExportSchedules(
		filters: ListTaxExportSchedulesFilters = {}
	): Promise<TaxExportSchedule[]> {
		const conditions = []
		if (filters.corporationId) {
			conditions.push(eq(taxExportSchedules.corporationId, filters.corporationId))
		}
		if (filters.activeOnly === true) {
			conditions.push(eq(taxExportSchedules.isActive, true))
		}

		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const rows = await this.db.query.taxExportSchedules.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(taxExportSchedules.nextRunAt)],
			limit,
			offset,
		})

		return rows.map((row) => this.toExportSchedule(row))
	}

	async runDueExportSchedules(
		asOf: Date = new Date(),
		limit = 25
	): Promise<{
		processed: number
		failures: Array<{
			scheduleId: string
			corporationId: string | null
			error: string
		}>
	}> {
		const boundedLimit = Math.min(Math.max(limit, 1), 100)
		const dueSchedules = await this.db.query.taxExportSchedules.findMany({
			where: and(eq(taxExportSchedules.isActive, true), lte(taxExportSchedules.nextRunAt, asOf)),
			orderBy: [asc(taxExportSchedules.nextRunAt)],
			limit: boundedLimit,
		})

		let processed = 0
		const failures: Array<{
			scheduleId: string
			corporationId: string | null
			error: string
		}> = []
		for (const schedule of dueSchedules) {
			try {
				await this.requestExport(schedule.createdByUserId, {
					corporationId: schedule.corporationId ?? undefined,
					format: schedule.format,
					reportType: schedule.reportType as RequestTaxExportInput['reportType'],
					filters: schedule.filters,
				})

				const nextRunBase = schedule.nextRunAt > asOf ? schedule.nextRunAt : asOf
				await this.db
					.update(taxExportSchedules)
					.set({
						lastRunAt: asOf,
						nextRunAt: this.computeNextRunAt(schedule.frequency, nextRunBase),
						updatedAt: new Date(),
					})
					.where(eq(taxExportSchedules.id, schedule.id))

				processed += 1
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				logger.error('[CorporationTax] Failed to run export schedule', {
					scheduleId: schedule.id,
					corporationId: schedule.corporationId,
					error: message,
				})
				failures.push({
					scheduleId: schedule.id,
					corporationId: schedule.corporationId,
					error: message,
				})
			}
		}

		return {
			processed,
			failures,
		}
	}

	async getExportHealth() {
		return {
			ready: true,
			message: 'Tax export workflows are configured',
		}
	}

	private async computeExportRowCount(input: RequestTaxExportInput): Promise<number> {
		const rows = await this.getReportRows(input)
		return rows.length
	}

	private async getReportRows(input: {
		reportType: TaxExportReportType
		corporationId?: string
		filters?: Record<string, unknown> | null
	}): Promise<Record<string, unknown>[]> {
		const reportFilters = this.toReportWindowFilters(input.filters, input.corporationId)

		switch (input.reportType) {
			case 'summary': {
				const row = await this.reportService.getSummaryReport(reportFilters)
				return [this.toSerializableRecord(row)]
			}
			case 'total_taxes_by_corporation': {
				const report = await this.reportService.getTotalTaxesByCorporationReport(reportFilters)
				return report.rows.map((row) => this.toSerializableRecord(row))
			}
			case 'top_income_sources': {
				const rows = await this.reportService.getTopIncomeSourcesReport(reportFilters)
				return rows.map((row) => this.toSerializableRecord(row))
			}
			case 'ess_payout': {
				const report = await this.reportService.getEssPayoutReport(reportFilters)
				return report.rows.map((row) => this.toSerializableRecord(row))
			}
			case 'compliance_over_time': {
				const rows = await this.reportService.getComplianceOverTimeReport(reportFilters)
				return rows.map((row) => this.toSerializableRecord(row))
			}
			case 'discrepancies': {
				const report = await this.reportService.getTaxDiscrepancyReport({
					corporationId: reportFilters.corporationId,
					fromDate: reportFilters.fromDate,
					toDate: reportFilters.toDate,
					onlyOpen: this.readBoolean(input.filters, 'onlyOpen'),
					limit: reportFilters.limit,
					offset: reportFilters.offset,
				})
				return report.rows.map((row) => this.toSerializableRecord(row))
			}
			case 'bill_status': {
				const rows = await this.reportService.getBillStatusReport(reportFilters)
				return rows.map((row) => this.toSerializableRecord(row))
			}
			default:
				return []
		}
	}

	private toReportWindowFilters(
		filters: Record<string, unknown> | null | undefined,
		corporationId?: string
	): TaxReportWindowFilters {
		const fromDateRaw = this.readString(filters, 'fromDate')
		const toDateRaw = this.readString(filters, 'toDate')
		const refTypesRaw = this.readStringArray(filters, 'refTypes')
		const refType = this.readString(filters, 'refType')
		const refTypes =
			refTypesRaw && refTypesRaw.length > 0 ? refTypesRaw : refType ? [refType] : undefined
		return {
			corporationId: corporationId ?? this.readString(filters, 'corporationId') ?? undefined,
			fromDate: fromDateRaw ? new Date(fromDateRaw) : undefined,
			toDate: toDateRaw ? new Date(toDateRaw) : undefined,
			division: this.readInteger(filters, 'division'),
			refType: refType ?? undefined,
			refTypes,
			firstPartyId: this.readString(filters, 'firstPartyId'),
			secondPartyId: this.readString(filters, 'secondPartyId'),
			minAmount: this.readString(filters, 'minAmount'),
			maxAmount: this.readString(filters, 'maxAmount'),
			limit: this.readInteger(filters, 'limit'),
			offset: this.readInteger(filters, 'offset'),
			sortBy: this.readString(filters, 'sortBy'),
			sortDirection:
				this.readString(filters, 'sortDirection') === 'asc' ||
				this.readString(filters, 'sortDirection') === 'desc'
					? (this.readString(filters, 'sortDirection') as 'asc' | 'desc')
					: undefined,
		}
	}

	private readString(
		filters: Record<string, unknown> | null | undefined,
		key: string
	): string | undefined {
		const value = filters?.[key]
		return typeof value === 'string' ? value : undefined
	}

	private readBoolean(
		filters: Record<string, unknown> | null | undefined,
		key: string
	): boolean | undefined {
		const value = filters?.[key]
		return typeof value === 'boolean' ? value : undefined
	}

	private readInteger(
		filters: Record<string, unknown> | null | undefined,
		key: string
	): number | undefined {
		const value = filters?.[key]
		return typeof value === 'number' && Number.isInteger(value) ? value : undefined
	}

	private readStringArray(
		filters: Record<string, unknown> | null | undefined,
		key: string
	): string[] | undefined {
		const value = filters?.[key]
		if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
			return undefined
		}
		const normalized = value.map((item) => item.trim()).filter(Boolean)
		return normalized.length > 0 ? normalized : undefined
	}

	private toSerializableRecord<T extends object>(input: T): Record<string, unknown> {
		return JSON.parse(
			JSON.stringify(input, (_key, currentValue) => {
				if (currentValue instanceof Date) {
					return currentValue.toISOString()
				}
				return currentValue
			})
		) as Record<string, unknown>
	}

	private toCsv(rows: Record<string, unknown>[]): string {
		if (rows.length === 0) {
			return ''
		}

		const headerSet = new Set<string>()
		for (const row of rows) {
			for (const key of Object.keys(row)) {
				headerSet.add(key)
			}
		}
		const headers = Array.from(headerSet)
		const lines = [headers.map((header) => this.escapeCsvValue(header)).join(',')]

		for (const row of rows) {
			const values = headers.map((header) => this.escapeCsvValue(row[header]))
			lines.push(values.join(','))
		}

		return lines.join('\n')
	}

	private escapeCsvValue(value: unknown): string {
		if (value === null || value === undefined) {
			return ''
		}

		let normalized: string
		if (typeof value === 'string') {
			normalized = value
		} else if (typeof value === 'number' || typeof value === 'boolean') {
			normalized = String(value)
		} else {
			normalized = JSON.stringify(value)
		}

		if (
			normalized.includes('"') ||
			normalized.includes(',') ||
			normalized.includes('\n') ||
			normalized.includes('\r')
		) {
			return `"${normalized.replace(/"/g, '""')}"`
		}

		return normalized
	}

	private toBase64Utf8(input: string): string {
		const bytes = new TextEncoder().encode(input)
		let binary = ''
		for (const byte of bytes) {
			binary += String.fromCharCode(byte)
		}
		return btoa(binary)
	}

	private normalizeJson(value: Record<string, unknown> | null): Record<string, unknown> | null {
		if (value === null) {
			return null
		}
		return JSON.parse(
			JSON.stringify(value, (_key, currentValue) => {
				return currentValue instanceof Date ? currentValue.toISOString() : currentValue
			})
		) as Record<string, unknown>
	}

	private computeNextRunAt(frequency: 'weekly' | 'monthly', from: Date): Date {
		const next = new Date(from)
		if (frequency === 'weekly') {
			next.setUTCDate(next.getUTCDate() + 7)
			return next
		}
		next.setUTCMonth(next.getUTCMonth() + 1)
		return next
	}

	private toExportRecord(row: typeof taxExports.$inferSelect): TaxExportRecord {
		return {
			id: row.id,
			corporationId: row.corporationId,
			requestedByUserId: row.requestedByUserId,
			format: row.format,
			reportType: row.reportType as TaxExportRecord['reportType'],
			status: row.status,
			filters: row.filters,
			rowCount: row.rowCount,
			sourceEsiVersion: row.sourceEsiVersion,
			error: row.error,
			requestedAt: row.requestedAt,
			completedAt: row.completedAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private toExportSchedule(row: typeof taxExportSchedules.$inferSelect): TaxExportSchedule {
		return {
			id: row.id,
			name: row.name,
			corporationId: row.corporationId,
			createdByUserId: row.createdByUserId,
			format: row.format,
			frequency: row.frequency,
			reportType: row.reportType as TaxExportSchedule['reportType'],
			filters: row.filters,
			isActive: row.isActive,
			nextRunAt: row.nextRunAt,
			lastRunAt: row.lastRunAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
