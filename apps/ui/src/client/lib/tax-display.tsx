import { TAX_INCOME_REF_TYPES } from '@repo/corporation-tax'

import { CorporationLogo } from '@/components/corporation-logo'

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
	agent_mission_reward: 'Mission Reward',
	agent_mission_time_bonus_reward: 'Mission Time Bonus Reward',
	bounty_prizes: 'Bounty Prizes',
	brokers_fee: 'Broker Fee',
	contract_collateral_payout: 'Contract Collateral Payout',
	contract_price: 'Contract Price',
	contract_price_payment_corp: 'Contract Price (Corp)',
	contract_reward: 'Contract Reward',
	corporate_reward_payout: 'Corporate Reward Payout',
	daily_goal_payouts: 'Daily Goal Payouts',
	ess_escrow_transfer: 'ESS Escrow Transfer',
	freelance_jobs_reward: 'Freelance Jobs Reward',
	industry_job_tax: 'Industry Job Tax',
	inheritance: 'Inheritance',
	insurance: 'Insurance',
	jump_clone_activation_fee: 'Jump Clone Activation Fee',
	jump_clone_installation_fee: 'Jump Clone Installation Fee',
	market_transaction: 'Market Transaction',
	office_rental_fee: 'Office Rental Fee',
	planetary_export_tax: 'Planetary Export Tax',
	planetary_import_tax: 'Planetary Import Tax',
	player_donation: 'Player Donation',
	project_discovery_reward: 'Project Discovery Reward',
	project_payouts: 'Project Payouts',
	reprocessing_tax: 'Reprocessing Tax',
	structure_gate_jump: 'Structure Gate Jump',
	war_fee_surrender: 'War Fee Surrender',
}

export const TAX_REF_TYPE_OPTIONS = TAX_INCOME_REF_TYPES.map((value) => ({
	value,
	label: REF_TYPE_LABELS[value] ?? startCaseFromSnake(value),
	id: value,
}))

const TAX_REF_TYPE_COLOR_PALETTE = [
	'#38bdf8',
	'#22d3ee',
	'#34d399',
	'#f59e0b',
	'#f97316',
	'#ef4444',
	'#a78bfa',
	'#f472b6',
	'#84cc16',
	'#06b6d4',
]

function buildGeneratedRefTypeColor(index: number, total: number): string {
	const hue = Math.round((index / Math.max(total, 1)) * 360)
	const saturation = index % 2 === 0 ? 72 : 66
	const lightness = index % 3 === 0 ? 58 : index % 3 === 1 ? 52 : 46
	return `hsl(${hue} ${saturation}% ${lightness}%)`
}

function buildFallbackRefTypeColor(refType: string): string {
	let hash = 0
	for (let index = 0; index < refType.length; index += 1) {
		hash = (hash * 31 + refType.charCodeAt(index)) >>> 0
	}
	const hue = hash % 360
	const saturation = 64 + (hash % 12)
	const lightness = 46 + (hash % 10)
	return `hsl(${hue} ${saturation}% ${lightness}%)`
}

const TAX_REF_TYPE_COLOR_MAP = new Map<string, string>(
	TAX_INCOME_REF_TYPES.map((refType, index) => [
		refType,
		index < TAX_REF_TYPE_COLOR_PALETTE.length
			? TAX_REF_TYPE_COLOR_PALETTE[index]!
			: buildGeneratedRefTypeColor(index, TAX_INCOME_REF_TYPES.length),
	])
)

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
	unexpected_income_ref_type_detected: 'Unexpected Income Ref Type Detected',
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

export function getTaxRefTypeColor(refType: string | null | undefined): string {
	if (!refType) {
		return '#38bdf8'
	}
	return TAX_REF_TYPE_COLOR_MAP.get(refType) ?? buildFallbackRefTypeColor(refType)
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

export function formatTaxAlertPayloadSummary(
	alert: Pick<TaxAlert, 'alertType' | 'payload'>
): string | null {
	if (alert.alertType !== 'unexpected_income_ref_type_detected') {
		return null
	}

	const refType =
		typeof alert.payload?.refType === 'string' && alert.payload.refType.trim().length > 0
			? alert.payload.refType.trim()
			: null

	const countValue = alert.payload?.entryCountInBatch
	const count =
		typeof countValue === 'number'
			? countValue
			: typeof countValue === 'string'
				? Number(countValue)
				: null

	const refLabel = refType ? formatTaxRefTypeLabel(refType) : null
	const countLabel =
		count !== null && Number.isFinite(count) ? `${Math.trunc(count)} entries` : null
	const detail = [refLabel, countLabel].filter(Boolean).join(' · ')

	return detail.length > 0 ? detail : null
}

export function formatTaxIskFull(amount: string | number | null | undefined): string {
	if (amount === null || amount === undefined || amount === '') {
		return '-'
	}

	const numericAmount = typeof amount === 'string' ? Number(amount) : amount
	if (!Number.isFinite(numericAmount)) {
		return '-'
	}

	return `${FULL_ISK_FORMATTER.format(numericAmount)} ISK`
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
	return `${formatted.replace('K', 'K').replace('M', 'M').replace('B', 'B').replace('T', 'T')} ISK`
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

export function TaxCorporationDisplay({
	corporationId,
	entityNames,
	emptyLabel = '-',
}: {
	corporationId: string | null | undefined
	entityNames?: Record<string, string>
	emptyLabel?: string
}) {
	if (!corporationId) {
		return <>{emptyLabel}</>
	}

	const corporationName = entityNames?.[corporationId]

	return (
		<div className="flex min-w-0 items-center gap-2">
			<CorporationLogo corporationId={corporationId} corporationName={corporationName} />
			<div className="min-w-0 leading-tight">
				<div className="truncate" title={corporationName ?? corporationId}>
					{corporationName ?? corporationId}
				</div>
				{corporationName ? (
					<div className="font-mono text-[11px] text-muted-foreground">{corporationId}</div>
				) : null}
			</div>
		</div>
	)
}
