import { TAX_INCOME_REF_TYPES } from '@repo/corporation-tax'

import { CorporationLogo } from '@/components/corporation-logo'
import { formatNumber, i18n } from '@/i18n'

import type { TaxAlert, TaxExportReportType } from '@repo/corporation-tax'

const REF_TYPE_LABELS: Record<string, string> = {
	get agent_mission_reward() {
		return i18n.t('tax.missionReward')
	},
	get agent_mission_time_bonus_reward() {
		return i18n.t('tax.missionTimeBonusReward')
	},
	get bounty_prizes() {
		return i18n.t('tax.bountyPrizes')
	},
	get brokers_fee() {
		return i18n.t('tax.brokerFee')
	},
	get contract_collateral_payout() {
		return i18n.t('tax.contractCollateralPayout')
	},
	get contract_price() {
		return i18n.t('tax.contractPrice')
	},
	get contract_price_payment_corp() {
		return i18n.t('tax.contractPriceCorp')
	},
	get contract_reward() {
		return i18n.t('tax.contractReward')
	},
	get corporate_reward_payout() {
		return i18n.t('tax.corporateRewardPayout')
	},
	get daily_goal_payouts() {
		return i18n.t('tax.dailyGoalPayouts')
	},
	get ess_escrow_transfer() {
		return i18n.t('tax.essEscrowTransfer')
	},
	get freelance_jobs_reward() {
		return i18n.t('tax.freelanceJobsReward')
	},
	get industry_job_tax() {
		return i18n.t('tax.industryJobTax')
	},
	get inheritance() {
		return i18n.t('tax.inheritance')
	},
	get insurance() {
		return i18n.t('tax.insurance')
	},
	get jump_clone_activation_fee() {
		return i18n.t('tax.jumpCloneActivationFee')
	},
	get jump_clone_installation_fee() {
		return i18n.t('tax.jumpCloneInstallationFee')
	},
	get market_transaction() {
		return i18n.t('tax.marketTransaction')
	},
	get office_rental_fee() {
		return i18n.t('tax.officeRentalFee')
	},
	get planetary_export_tax() {
		return i18n.t('tax.planetaryExportTax')
	},
	get planetary_import_tax() {
		return i18n.t('tax.planetaryImportTax')
	},
	get player_donation() {
		return i18n.t('tax.playerDonation')
	},
	get project_discovery_reward() {
		return i18n.t('tax.projectDiscoveryReward')
	},
	get project_payouts() {
		return i18n.t('tax.projectPayouts')
	},
	get reprocessing_tax() {
		return i18n.t('tax.reprocessingTax')
	},
	get structure_gate_jump() {
		return i18n.t('tax.structureGateJump')
	},
	get war_fee_surrender() {
		return i18n.t('tax.warFeeSurrender')
	},
}

export const getTaxRefTypeOptions = () =>
	TAX_INCOME_REF_TYPES.map((value) => ({
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
	get corporation_wallet_journal() {
		return i18n.t('tax.corporationWalletJournal')
	},
	get corporation_wallet_transaction() {
		return i18n.t('tax.corporationWalletTransaction')
	},
	get character_wallet_journal() {
		return i18n.t('tax.characterWalletJournal')
	},
	get character_wallet_transaction() {
		return i18n.t('tax.characterWalletTransaction')
	},
}

export const getTaxLedgerSourceTypeOptions = () =>
	Object.entries(LEDGER_SOURCE_TYPE_LABELS).map(([value, label]) => ({
		value,
		label,
		id: value,
	}))

const REPORT_TYPE_LABELS: Record<TaxExportReportType, string> = {
	get summary() {
		return i18n.t('tax.summary')
	},
	get total_taxes_by_corporation() {
		return i18n.t('tax.totalTaxes')
	},
	get top_income_sources() {
		return i18n.t('tax.incomeSources')
	},
	ess_payout: 'ESS',
	get compliance_over_time() {
		return i18n.t('tax.compliance')
	},
	get discrepancies() {
		return i18n.t('tax.discrepancies2')
	},
	get bill_status() {
		return i18n.t('tax.billStatus')
	},
}

const ALERT_TYPE_LABELS: Record<string, string> = {
	get esi_key_missing() {
		return i18n.t('tax.esiKeyMissing')
	},
	get corp_token_invalid() {
		return i18n.t('tax.corporationTokenInvalid')
	},
	get corp_missing_wallet_scope() {
		return i18n.t('tax.missingWalletScope')
	},
	get wallet_division_config_missing() {
		return i18n.t('tax.walletDivisionConfigurationMissing')
	},
	get tax_discrepancy_detected() {
		return i18n.t('tax.taxDiscrepancyDetected')
	},
	get tax_discrepancy_threshold_exceeded() {
		return i18n.t('tax.taxDiscrepancyThresholdExceeded')
	},
	get ess_threshold_exceeded() {
		return i18n.t('tax.essThresholdExceeded')
	},
	get bill_sync_failed() {
		return i18n.t('tax.billSyncFailed')
	},
	get discord_delivery_failed() {
		return i18n.t('tax.discordDeliveryFailed')
	},
	get scheduled_operations_failed() {
		return i18n.t('tax.scheduledOperationsFailed')
	},
	get scheduled_export_failed() {
		return i18n.t('tax.scheduledExportFailed')
	},
	get ess_duplicate_records_detected() {
		return i18n.t('tax.duplicateEssRecordsDetected')
	},
	get ess_missing_records_detected() {
		return i18n.t('tax.missingEssRecordsDetected')
	},
	get unexpected_income_ref_type_detected() {
		return i18n.t('tax.unexpectedIncomeRefTypeDetected')
	},
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

	return i18n.t('tax.divisionValue1', { value1: division })
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
		return (
			entityNames?.[alert.corporationId] ??
			i18n.t('tax.corporationValue1', { value1: alert.corporationId })
		)
	}

	const operation =
		typeof alert.payload?.operation === 'string' ? alert.payload.operation : undefined
	if (operation) {
		return startCaseFromSnake(operation)
	}

	return i18n.t('tax.global')
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
		count !== null && Number.isFinite(count)
			? i18n.t('tax.entryCount', { count: Math.trunc(count) })
			: null
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

	return `${formatNumber(numericAmount, { maximumFractionDigits: 2 })} ISK`
}

export function formatTaxIskCompact(amount: string | number | null | undefined): string {
	if (amount === null || amount === undefined || amount === '') {
		return '-'
	}

	const numericAmount = typeof amount === 'string' ? Number(amount) : amount
	if (!Number.isFinite(numericAmount)) {
		return '-'
	}

	const formatted = formatNumber(numericAmount, { maximumFractionDigits: 2, notation: 'compact' })
	return `${formatted} ISK`
}

export function formatTaxNumber(value: string | number | null | undefined): string {
	if (value === null || value === undefined || value === '') {
		return '-'
	}

	const numericValue = typeof value === 'string' ? Number(value) : value
	if (!Number.isFinite(numericValue)) {
		return '-'
	}

	return formatNumber(numericValue, { maximumFractionDigits: 2 })
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

/** Known domain values are translated without changing their transport identifiers. */
export function formatTaxStatus(value: string): string {
	switch (value) {
		case 'draft':
			return i18n.t('tax.statusLabels.draft')
		case 'underpaid':
			return i18n.t('tax.statusLabels.underpaid')
		case 'paid':
			return i18n.t('tax.statusLabels.paid')
		case 'overpaid':
			return i18n.t('tax.statusLabels.overpaid')
		case 'excluded':
			return i18n.t('tax.statusLabels.excluded')
		case 'open':
			return i18n.t('tax.statusLabels.open')
		case 'acknowledged':
			return i18n.t('tax.statusLabels.acknowledged')
		case 'resolved':
			return i18n.t('tax.statusLabels.resolved')
		case 'queued':
			return i18n.t('tax.statusLabels.queued')
		case 'running':
			return i18n.t('tax.statusLabels.running')
		case 'completed':
			return i18n.t('tax.statusLabels.completed')
		case 'failed':
			return i18n.t('tax.statusLabels.failed')
		case 'pending':
			return i18n.t('tax.statusLabels.pending')
		case 'sent':
			return i18n.t('tax.statusLabels.sent')
		case 'skipped':
			return i18n.t('tax.statusLabels.skipped')
		case 'critical':
			return i18n.t('tax.statusLabels.critical')
		case 'warning':
			return i18n.t('tax.statusLabels.warning')
		case 'info':
			return i18n.t('tax.statusLabels.info')
		case 'active':
			return i18n.t('tax.statusLabels.active')
		case 'paused':
			return i18n.t('tax.statusLabels.paused')
		case 'corporation':
			return i18n.t('tax.statusLabels.corporation')
		case 'character':
			return i18n.t('tax.statusLabels.character')
		default:
			return value
	}
}
