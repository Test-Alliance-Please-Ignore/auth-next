import type { TaxAlert, TaxExportReportType } from '@repo/corporation-tax'

const FULL_ISK_FORMATTER = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
})

const GROUPED_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
})

const COMPACT_ISK_FORMATTER = new Intl.NumberFormat('en-US', {
	maximumFractionDigits: 2,
	minimumFractionDigits: 0,
	notation: 'compact',
})

const REF_TYPE_LABELS: Record<string, string> = {
	bounty_prizes: 'Bounty Prizes',
	market_transaction: 'Market Transaction',
	player_donation: 'Player Donation',
	ess_escrow_transfer: 'ESS Escrow Transfer',
	agent_mission_reward: 'Mission Reward',
	agent_mission_time_bonus_reward: 'Mission Time Bonus',
	corporation_tax: 'Corporation Tax',
}

export const TAX_REF_TYPE_OPTIONS = Object.entries(REF_TYPE_LABELS).map(([value, label]) => ({
	value,
	label,
	id: value,
}))

const LEDGER_SOURCE_TYPE_LABELS: Record<string, string> = {
	corporation_wallet_journal: 'Corporation Wallet Journal',
	corporation_wallet_transaction: 'Corporation Wallet Transaction',
	character_wallet_journal: 'Character Wallet Journal',
	character_wallet_transaction: 'Character Wallet Transaction',
}

export const TAX_LEDGER_SOURCE_TYPE_OPTIONS = Object.entries(LEDGER_SOURCE_TYPE_LABELS).map(
	([value, label]) => ({
		value,
		label,
		id: value,
	})
)

const REPORT_TYPE_LABELS: Record<TaxExportReportType, string> = {
	summary: 'Summary',
	total_taxes_by_corporation: 'Total Taxes',
	top_income_sources: 'Income Sources',
	ess_payout: 'ESS',
	compliance_over_time: 'Compliance',
	discrepancies: 'Discrepancies',
	bill_status: 'Bill Status',
}

const ALERT_TYPE_LABELS: Record<string, string> = {
	esi_key_missing: 'ESI Key Missing',
	corp_token_invalid: 'Corporation Token Invalid',
	corp_missing_wallet_scope: 'Missing Wallet Scope',
	wallet_division_config_missing: 'Wallet Division Configuration Missing',
	tax_discrepancy_detected: 'Tax Discrepancy Detected',
	tax_discrepancy_threshold_exceeded: 'Tax Discrepancy Threshold Exceeded',
	ess_threshold_exceeded: 'ESS Threshold Exceeded',
	bill_sync_failed: 'Bill Sync Failed',
	discord_delivery_failed: 'Discord Delivery Failed',
	scheduled_operations_failed: 'Scheduled Operations Failed',
	scheduled_export_failed: 'Scheduled Export Failed',
	ess_duplicate_records_detected: 'Duplicate ESS Records Detected',
	ess_missing_records_detected: 'Missing ESS Records Detected',
}

function startCaseFromSnake(value: string): string {
	return value
		.split('_')
		.filter(Boolean)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(' ')
}

export function formatTaxRefTypeLabel(refType: string | null | undefined): string {
	if (!refType) {
		return '-'
	}

	return REF_TYPE_LABELS[refType] ?? startCaseFromSnake(refType)
}

export function formatTaxLedgerSourceTypeLabel(sourceType: string | null | undefined): string {
	if (!sourceType) {
		return '-'
	}

	return LEDGER_SOURCE_TYPE_LABELS[sourceType] ?? startCaseFromSnake(sourceType)
}

export function formatTaxDivisionLabel(division: number | string | null | undefined): string {
	if (division === null || division === undefined || division === '') {
		return '-'
	}

	return `Division ${division}`
}

export function formatTaxReportTypeLabel(reportType: TaxExportReportType | string): string {
	if (reportType in REPORT_TYPE_LABELS) {
		return REPORT_TYPE_LABELS[reportType as TaxExportReportType]
	}

	return startCaseFromSnake(reportType)
}

export function formatTaxAlertTypeLabel(alertType: string | null | undefined): string {
	if (!alertType) {
		return '-'
	}

	return ALERT_TYPE_LABELS[alertType] ?? startCaseFromSnake(alertType)
}

export function formatTaxAlertContext(
	alert: Pick<TaxAlert, 'corporationId' | 'payload'>,
	entityNames?: Record<string, string>
): string {
	if (alert.corporationId) {
		return entityNames?.[alert.corporationId] ?? `Corporation ${alert.corporationId}`
	}

	const operation =
		typeof alert.payload?.operation === 'string' ? alert.payload.operation : undefined
	if (operation) {
		return startCaseFromSnake(operation)
	}

	return 'Global'
}

export function formatTaxIskFull(amount: string | number | null | undefined): string {
	if (amount === null || amount === undefined || amount === '') {
		return '-'
	}

	const numericAmount = typeof amount === 'string' ? Number(amount) : amount
	if (!Number.isFinite(numericAmount)) {
		return '-'
	}

	return FULL_ISK_FORMATTER.format(numericAmount)
}

export function formatTaxIskCompact(amount: string | number | null | undefined): string {
	if (amount === null || amount === undefined || amount === '') {
		return '-'
	}

	const numericAmount = typeof amount === 'string' ? Number(amount) : amount
	if (!Number.isFinite(numericAmount)) {
		return '-'
	}

	const formatted = COMPACT_ISK_FORMATTER.format(numericAmount)
	return formatted.replace('K', 'K').replace('M', 'M').replace('B', 'B').replace('T', 'T')
}

export function formatTaxNumber(value: string | number | null | undefined): string {
	if (value === null || value === undefined || value === '') {
		return '-'
	}

	const numericValue = typeof value === 'string' ? Number(value) : value
	if (!Number.isFinite(numericValue)) {
		return '-'
	}

	return GROUPED_NUMBER_FORMATTER.format(numericValue)
}

export function TaxEntityDisplay({
	entityId,
	entityNames,
	emptyLabel = '-',
}: {
	entityId: string | null | undefined
	entityNames?: Record<string, string>
	emptyLabel?: string
}) {
	if (!entityId) {
		return <>{emptyLabel}</>
	}

	const resolvedName = entityNames?.[entityId]
	if (!resolvedName) {
		return <span className="font-mono text-xs text-muted-foreground">{entityId}</span>
	}

	return (
		<div className="leading-tight">
			<div>{resolvedName}</div>
			<div className="font-mono text-[11px] text-muted-foreground">{entityId}</div>
		</div>
	)
}
