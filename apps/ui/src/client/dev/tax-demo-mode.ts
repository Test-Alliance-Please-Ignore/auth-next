import type { QueryClient } from '@tanstack/react-query'
import type {
	CreateTaxCorporationBillingConfigInput,
	IssueBillsForPeriodResult,
	SyncCorporationBillStatusesResult,
	TaxAlert,
	TaxAlertSeverity,
	TaxAlertStatus,
	TaxAssessment,
	TaxAssessmentWithBillHistory,
	TaxAuditLogEntry,
	TaxBillingEventHistoryRow,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxCorporationBillingConfig,
	TaxCorporationExclusion,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExportArtifact,
	TaxExportFormat,
	TaxExportRecord,
	TaxExportSchedule,
	TaxExportStatus,
	TaxLedgerEntry,
	TaxMemberSummary,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxPagedResult,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	UpdateTaxCorporationBillingConfigInput,
} from '@repo/corporation-tax'
import type { TaxRollupReportQueryFilters } from '@/lib/tax-report-types'

const ENABLED_STORAGE_KEY = 'auth-next.tax-demo.enabled'
const SEED_STORAGE_KEY = 'auth-next.tax-demo.seed'
const CONFIG_STORAGE_KEY = 'auth-next.tax-demo.config'

type DemoTaxConfig = {
	corporationCount: number
	months: number
}

const DEFAULT_DEMO_TAX_CONFIG: DemoTaxConfig = {
	corporationCount: 50,
	months: 3,
}

type TaxCapabilitiesResponse = {
	corporationId: string | null
	global: { canRead: boolean; canAudit: boolean; canManage: boolean }
	scoped: { canRead: boolean; canAudit: boolean; canManage: boolean }
}

type TaxReportFilters = TaxRollupReportQueryFilters

type DemoTaxState = ReturnType<typeof buildDemoState>

function isDevRuntime(): boolean {
	return import.meta.env.DEV && typeof window !== 'undefined'
}

function readStoredSeed(): number {
	if (!isDevRuntime()) return Date.now()
	const raw = window.localStorage.getItem(SEED_STORAGE_KEY)
	return raw ? Number(raw) || Date.now() : Date.now()
}

function persistSeed(seed: number): void {
	if (!isDevRuntime()) return
	window.localStorage.setItem(SEED_STORAGE_KEY, String(seed))
}

function readEnabled(): boolean {
	if (!isDevRuntime()) return false
	return window.localStorage.getItem(ENABLED_STORAGE_KEY) === 'true'
}

function persistEnabled(enabled: boolean): void {
	if (!isDevRuntime()) return
	if (enabled) window.localStorage.setItem(ENABLED_STORAGE_KEY, 'true')
	else window.localStorage.removeItem(ENABLED_STORAGE_KEY)
}

function sanitizeDemoConfig(input?: Partial<DemoTaxConfig> | null): DemoTaxConfig {
	return {
		corporationCount: Math.max(
			4,
			Math.min(60, Math.floor(input?.corporationCount ?? DEFAULT_DEMO_TAX_CONFIG.corporationCount))
		),
		months: Math.max(1, Math.min(12, Math.floor(input?.months ?? DEFAULT_DEMO_TAX_CONFIG.months))),
	}
}

function readStoredConfig(): DemoTaxConfig {
	if (!isDevRuntime()) return DEFAULT_DEMO_TAX_CONFIG
	const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY)
	if (!raw) return DEFAULT_DEMO_TAX_CONFIG

	try {
		return sanitizeDemoConfig(JSON.parse(raw) as Partial<DemoTaxConfig>)
	} catch {
		return DEFAULT_DEMO_TAX_CONFIG
	}
}

function persistConfig(config: DemoTaxConfig): void {
	if (!isDevRuntime()) return
	window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
}

function withLatency<T>(value: T): Promise<T> {
	return new Promise((resolve) => window.setTimeout(() => resolve(value), 120))
}

function startOfMonth(date = new Date()): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addDays(date: Date, days: number): Date {
	const copy = new Date(date)
	copy.setUTCDate(copy.getUTCDate() + days)
	return copy
}

function amount(value: number): string {
	return value.toFixed(2)
}

function parseAmount(value: string | null | undefined): number {
	return value ? Number(value) || 0 : 0
}

function matchesDate(value: string | Date, fromDate?: string, toDate?: string): boolean {
	const current = new Date(value).getTime()
	if (fromDate && current < new Date(fromDate).getTime()) return false
	if (toDate && current > new Date(toDate).getTime()) return false
	return true
}

function applyLimitOffset<T>(rows: T[], limit?: number, offset?: number): T[] {
	const start = Math.max(offset ?? 0, 0)
	const end = limit ? start + limit : undefined
	return rows.slice(start, end)
}

function buildDemoTimelineForAssessment(
	assessment: TaxAssessment,
	sequenceSeed = 0
): TaxAssessmentWithBillHistory['timeline'] {
	if (!assessment.billId) return []

	const billId = assessment.billId
	const createdAt = new Date(assessment.createdAt)
	const issuedAt = new Date(createdAt)
	issuedAt.setUTCMinutes(issuedAt.getUTCMinutes() + 15)
	const updatedAt = new Date(assessment.updatedAt)

	const baseEvents: TaxAssessmentWithBillHistory['timeline'] = [
		{
			id: `${billId}-evt-${sequenceSeed}-created`,
			billId,
			eventType: 'created',
			fromStatus: null,
			toStatus: 'draft',
			actorUserId: 'demo-admin',
			metadata: null,
			createdAt,
		},
		{
			id: `${billId}-evt-${sequenceSeed}-issued`,
			billId,
			eventType: 'issued',
			fromStatus: 'draft',
			toStatus: 'issued',
			actorUserId: 'demo-admin',
			metadata: null,
			createdAt: issuedAt,
		},
	]

	if (assessment.billStatus === 'overdue') {
		baseEvents.push({
			id: `${billId}-evt-${sequenceSeed}-overdue`,
			billId,
			eventType: 'overdue',
			fromStatus: 'issued',
			toStatus: 'overdue',
			actorUserId: null,
			metadata: null,
			createdAt: updatedAt,
		})
	}

	if (assessment.billStatus === 'paid') {
		const paymentAt = new Date(updatedAt)
		paymentAt.setUTCMinutes(paymentAt.getUTCMinutes() - 5)
		baseEvents.push({
			id: `${billId}-evt-${sequenceSeed}-payment-recorded`,
			billId,
			eventType: 'payment_recorded',
			fromStatus: null,
			toStatus: null,
			actorUserId: null,
			metadata: {
				amount: assessment.taxDue,
			},
			createdAt: paymentAt,
		})
		baseEvents.push({
			id: `${billId}-evt-${sequenceSeed}-paid`,
			billId,
			eventType: 'paid',
			fromStatus: 'issued',
			toStatus: 'paid',
			actorUserId: null,
			metadata: null,
			createdAt: updatedAt,
		})
	}

	if (assessment.billStatus === 'cancelled') {
		baseEvents.push({
			id: `${billId}-evt-${sequenceSeed}-cancelled`,
			billId,
			eventType: 'cancelled',
			fromStatus: 'issued',
			toStatus: 'cancelled',
			actorUserId: 'demo-admin',
			metadata: null,
			createdAt: updatedAt,
		})
	}

	return baseEvents
}

function rebuildDemoBillHistory(state: DemoTaxState): void {
	const billedByCorporation = new Map<string, TaxAssessment[]>()
	for (const assessment of state.assessments) {
		if (assessment.assessmentScope !== 'corporation' || !assessment.billId) continue
		const list = billedByCorporation.get(assessment.corporationId) ?? []
		list.push(assessment)
		billedByCorporation.set(assessment.corporationId, list)
	}

	const billHistoryRows: TaxAssessment[] = []
	const maxPerCorporation = 3
	for (const setting of state.settings) {
		const scoped = billedByCorporation.get(setting.corporationId) ?? []
		billHistoryRows.push(...scoped.slice(0, maxPerCorporation))
	}

	state.billHistory = billHistoryRows.map((assessment, index) => ({
		assessment,
		timeline: buildDemoTimelineForAssessment(assessment, index),
	}))
}

function buildDemoState(seed: number) {
	const config = readStoredConfig()
	const monthStart = startOfMonth()
	const demoStart = addDays(monthStart, -30 * Math.max(0, config.months - 1))
	const demoDaySpan = Math.max(config.months * 30, 30)
	const corpNamePrefixes = [
		'Orion',
		'Aegis',
		'Helios',
		'Sable',
		'Vanguard',
		'Nova',
		'Citadel',
		'Aurora',
		'Iron',
		'Obsidian',
		'Ember',
		'Stellar',
		'Argent',
		'Tempest',
		'Radiant',
		'Black Sky',
		'Meridian',
		'Redline',
		'Keystone',
		'Frontier',
	]
	const corpNameSuffixes = [
		'Industrial',
		'Logistics',
		'Security',
		'Trade Union',
		'Holdings',
		'Expeditions',
		'Mercantile',
		'Consortium',
		'Assembly',
		'Command',
	]
	const corporations = Array.from({ length: config.corporationCount }).map((_, index) => ({
		corporationId: `${99010001 + index}`,
		name: `${corpNamePrefixes[index % corpNamePrefixes.length]} ${
			corpNameSuffixes[Math.floor(index / corpNamePrefixes.length) % corpNameSuffixes.length]
		}`,
	}))

	const entityNames: Record<string, string> = Object.fromEntries(
		corporations.map((corp) => [corp.corporationId, corp.name])
	)

	const characters = [
		{ characterId: '70000001', name: 'Ariadne Voss' },
		{ characterId: '70000002', name: 'Talon Mere' },
		{ characterId: '70000003', name: 'Cass Ordo' },
		{ characterId: '70000004', name: 'Nyx Calder' },
		{ characterId: '70000005', name: 'Vera Kade' },
		{ characterId: '70000006', name: 'Jax Ren' },
		{ characterId: '70000007', name: 'Mira Sol' },
		{ characterId: '70000008', name: 'Oren Vale' },
	]

	for (const character of characters) {
		entityNames[character.characterId] = character.name
	}

	Object.assign(entityNames, {
		'80000001': 'CONCORD Treasury',
		'80000002': 'Main Bank Reserve',
		'80000003': 'Outer Ring Buyers',
	})

	const settings = corporations.map((corp, index) => ({
		corporationId: corp.corporationId,
		included: index % 9 !== 3,
		exclusionReason: index % 9 === 3 ? 'Manual exemption for trade corp.' : null,
		esiAuthStatus: {
			isConfigured: true,
			isVerified: true,
			lastVerified: addDays(demoStart, Math.min(2 + index * 2, demoDaySpan - 1)),
			directorCount: 4,
			healthyDirectorCount: index % 7 === 2 ? 2 : 4,
			requiredScopes: ['esi-wallet.read_corporation_wallets.v1'],
			missingRequiredScopes: index % 7 === 2 ? ['esi-wallet.read_character_wallet.v1'] : [],
			hasRequiredScopes: index % 7 !== 2,
			hasCorporationWalletScope: true,
			hasCharacterWalletScope: index % 7 !== 2,
			hasCorporationMembershipScope: true,
			grantedScopeCount: index % 7 === 2 ? 2 : 3,
		},
		createdAt: addDays(demoStart, index),
		updatedAt: addDays(demoStart, Math.min(index * 2, demoDaySpan - 1)),
	})) as Array<{
		corporationId: string
		included: boolean
		exclusionReason: string | null
		esiAuthStatus: {
			isConfigured: boolean
			isVerified: boolean
			lastVerified: Date | null
			directorCount: number
			healthyDirectorCount: number
			requiredScopes: string[]
			missingRequiredScopes: string[]
			hasRequiredScopes: boolean
			hasCorporationWalletScope: boolean
			hasCharacterWalletScope: boolean
			hasCorporationMembershipScope: boolean
			grantedScopeCount: number
		}
		createdAt: Date
		updatedAt: Date
	}>

	const divisionProfiles = [
		[1, 2, 3, 4],
		[1, 2, 5],
		[1, 3, 6],
		[1, 2],
		[1, 4, 7],
	]

	const walletDivisions = Object.fromEntries(
		corporations.map((corp, index) => [
			corp.corporationId,
			divisionProfiles[index % divisionProfiles.length]!,
		])
	) as Record<string, number[]>

	const discrepancies = corporations
		.filter((_, index) => index % 4 === 1 || index % 7 === 2)
		.map((corp, index) => ({
			id: `disc-${index + 1}`,
			corporationId: corp.corporationId,
			discrepancyType: index % 2 === 0 ? 'rate_mismatch' : 'ess_missing_records',
			severity: (index % 3 === 0 ? 'critical' : 'warning') as TaxDiscrepancy['severity'],
			assessmentId: index % 2 === 0 ? `assess-${index + 3}` : null,
			createdAt: addDays(demoStart, 9 + index * 3),
			updatedAt: addDays(demoStart, 9 + index * 3),
			details:
				index % 2 === 0
					? { expectedRate: '7.50%', observedRate: '5.00%' }
					: { missingTransfers: 3 + (index % 4) },
			resolvedAt: null,
		})) as unknown as TaxDiscrepancy[]

	const ledgerEntries = Array.from({
		length: Math.max(config.corporationCount * config.months * 12, 120),
	}).map((_, index) => {
		const corporation = corporations[index % corporations.length]!
		const divisionList = walletDivisions[corporation.corporationId]!
		const refType = [
			'bounty_prizes',
			'market_transaction',
			'ess_escrow_transfer',
			'player_donation',
		][index % 4]!
		const sourceType = [
			'corporation_wallet_journal',
			'corporation_wallet_transaction',
			'character_wallet_journal',
			'character_wallet_transaction',
		][index % 4]! as TaxLedgerEntry['sourceType']
		return {
			id: `ledger-${index}`,
			corporationId: corporation.corporationId,
			characterId: characters[index % characters.length]!.characterId,
			entryDate: addDays(demoStart, index % demoDaySpan),
			amount: amount(920_000_000 + index * 210_000_000),
			direction: 'inflow',
			refType,
			division: divisionList[index % divisionList.length] ?? 1,
			sourceType,
			sourcePrimaryId: `${sourceType}-${index}`,
			firstPartyId:
				index % 3 === 0 ? '80000003' : characters[index % characters.length]!.characterId,
			secondPartyId: '80000001',
			sourceId: `src-${index}`,
			sourceSecondaryId: `${divisionList[index % divisionList.length] ?? 1}`,
			sourceKey: `demo:${index}`,
			balance: amount(96_000_000_000 - index * 1_450_000_000),
			createdAt: addDays(demoStart, index % demoDaySpan),
			updatedAt: addDays(demoStart, index % demoDaySpan),
		}
	}) as unknown as TaxLedgerEntry[]

	const memberSummary = Array.from({ length: Math.max(config.corporationCount * 2, 12) }).map(
		(_, index) => {
			const corporation = corporations[index % corporations.length]!
			const characterId = characters[index % characters.length]!.characterId
			const contributionIncome = 9_400_000_000 + index * 1_140_000_000
			const taxableContributionIncome = contributionIncome * 0.72
			return {
				corporationId: corporation.corporationId,
				characterId,
				assessmentCount: 2 + index,
				contributionIncome: amount(contributionIncome),
				taxableContributionIncome: amount(taxableContributionIncome),
				lastAssessmentAt: addDays(demoStart, Math.max(0, demoDaySpan - 12 + (index % 10))),
				topRefTypes: [
					{
						refType: 'bounty_prizes',
						lineCount: 8 + index,
						taxableAmount: amount(9_850_000_000 + index * 1_120_000_000),
						taxAmount: amount(738_750_000 + index * 84_000_000),
					},
					{
						refType: 'ess_escrow_transfer',
						lineCount: 2 + index,
						taxableAmount: amount(1_480_000_000 + index * 280_000_000),
						taxAmount: amount(140_600_000 + index * 26_600_000),
					},
				],
			}
		}
	) as TaxMemberSummary[]

	const assessments = Array.from({
		length: Math.max(config.corporationCount * config.months * 5, 80),
	}).map((_, index) => {
		const corporation = corporations[index % corporations.length]!
		const scope = index % 4 === 0 ? 'division' : index % 3 === 0 ? 'character' : 'corporation'
		const due = 1_420_000_000 + index * 330_000_000
		const paid = scope === 'corporation' ? due - 160_000_000 : due - 95_000_000
		const billId = index % 5 === 0 ? null : `bill-${index}`
		const status = billId
			? ((index % 6 === 0 ? 'paid' : 'underpaid') as TaxAssessment['status'])
			: ('underpaid' as TaxAssessment['status'])
		const taxDelta = status === 'paid' ? 0 : due - Math.max(0, paid)
		return {
			id: `assess-${index}`,
			corporationId: corporation.corporationId,
			assessmentScope: scope,
			scopeId:
				scope === 'division'
					? String((walletDivisions[corporation.corporationId] ?? [1])[0] ?? 1)
					: scope === 'character'
						? characters[index % characters.length]!.characterId
						: corporation.corporationId,
			status,
			taxDue: amount(due),
			taxDelta: amount(taxDelta),
			taxPeriodEnd: addDays(demoStart, Math.min(index % demoDaySpan, demoDaySpan - 1)),
			taxPeriodStart: addDays(demoStart, Math.max(0, (index % demoDaySpan) - 29)),
			billId,
			billStatus: (billId
				? status === 'paid'
					? 'paid'
					: 'issued'
				: null) as TaxAssessment['billStatus'],
			createdAt: addDays(demoStart, index % demoDaySpan),
			updatedAt: addDays(demoStart, Math.min((index % demoDaySpan) + 2, demoDaySpan - 1)),
		}
	}) as TaxAssessment[]

	// Keep unbilled demo rows in a consistent state for billing UX.
	for (const row of assessments) {
		if (!row.billId) {
			row.status = 'underpaid'
			row.billStatus = null
		}
	}

	// Ensure every corporation has both:
	// 1) at least one corporation-scope billed assessment (for bill history)
	// 2) at least one corporation-scope unbilled finalized assessment (for unbilled table)
	let nextAssessmentIndex = assessments.length
	for (const corporation of corporations) {
		const corporationAssessments = assessments.filter(
			(row) =>
				row.corporationId === corporation.corporationId && row.assessmentScope === 'corporation'
		)
		const hasBilled = corporationAssessments.some((row) => Boolean(row.billId))
		const hasUnbilledFinalized = corporationAssessments.some(
			(row) => !row.billId && row.status !== 'draft' && row.status !== 'excluded'
		)

		if (!hasBilled) {
			const due = 1_900_000_000 + nextAssessmentIndex * 110_000_000
			assessments.push({
				id: `assess-${nextAssessmentIndex}`,
				corporationId: corporation.corporationId,
				assessmentScope: 'corporation',
				scopeId: corporation.corporationId,
				status: 'underpaid',
				taxableIncome: amount(due * 12),
				nonTaxableIncome: amount(due * 2),
				taxDue: amount(due),
				taxDelta: amount(due * 0.12),
				inGameTaxRateBps: 500,
				taxPeriodEnd: addDays(demoStart, Math.max(0, demoDaySpan - 6)),
				taxPeriodStart: addDays(demoStart, Math.max(0, demoDaySpan - 36)),
				billId: `bill-${nextAssessmentIndex}`,
				billStatus: 'issued',
				billStatusLastSyncedAt: addDays(demoStart, Math.max(0, demoDaySpan - 4)),
				approvedBy: null,
				approvedAt: null,
				createdAt: addDays(demoStart, Math.max(0, demoDaySpan - 8)),
				updatedAt: addDays(demoStart, Math.max(0, demoDaySpan - 4)),
			})
			nextAssessmentIndex += 1
		}

		if (!hasUnbilledFinalized) {
			const due = 1_600_000_000 + nextAssessmentIndex * 95_000_000
			assessments.push({
				id: `assess-${nextAssessmentIndex}`,
				corporationId: corporation.corporationId,
				assessmentScope: 'corporation',
				scopeId: corporation.corporationId,
				status: 'underpaid',
				taxableIncome: amount(due * 10),
				nonTaxableIncome: amount(due * 1.5),
				taxDue: amount(due),
				taxDelta: amount(due * 0.04),
				inGameTaxRateBps: 500,
				taxPeriodEnd: addDays(demoStart, Math.max(0, demoDaySpan - 3)),
				taxPeriodStart: addDays(demoStart, Math.max(0, demoDaySpan - 33)),
				billId: null,
				billStatus: null,
				billStatusLastSyncedAt: null,
				approvedBy: null,
				approvedAt: null,
				createdAt: addDays(demoStart, Math.max(0, demoDaySpan - 5)),
				updatedAt: addDays(demoStart, Math.max(0, demoDaySpan - 2)),
			})
			nextAssessmentIndex += 1
		}
	}

	const billHistory = assessments
		.filter((assessment) => assessment.assessmentScope === 'corporation' && assessment.billId)
		.slice(0, Math.max(16, config.corporationCount))
		.map((assessment, index) => ({
			assessment,
			timeline: buildDemoTimelineForAssessment(assessment, index),
		})) as TaxAssessmentWithBillHistory[]

	const alerts = [
		{
			id: 'alert-1',
			alertType: 'tax_discrepancy_detected',
			severity: 'warning',
			status: 'open',
			corporationId: '99010003',
			lastTriggeredAt: addDays(monthStart, 9),
			discordDeliveryStatus: 'delivered',
			discordAttemptCount: 1,
		},
		{
			id: 'alert-2',
			alertType: 'esi_key_missing',
			severity: 'critical',
			status: 'open',
			corporationId: '99010002',
			lastTriggeredAt: addDays(monthStart, 11),
			discordDeliveryStatus: 'failed',
			discordAttemptCount: 3,
		},
	] as TaxAlert[]

	const auditLog = [
		{
			id: 'audit-1',
			corporationId: '99010001',
			actorUserId: 'demo-admin',
			action: 'tax.exclusion.updated',
			before: { reason: null },
			after: { reason: 'Manual exemption for trade corp.' },
			createdAt: addDays(monthStart, 2),
		},
		{
			id: 'audit-2',
			corporationId: '99010002',
			actorUserId: 'demo-admin',
			action: 'tax.export.requested',
			before: null,
			after: { reportType: 'total_taxes_by_corporation' },
			createdAt: addDays(monthStart, 6),
		},
	] as TaxAuditLogEntry[]

	const missingEsi = settings
		.filter((setting) => setting.esiAuthStatus && !setting.esiAuthStatus.hasRequiredScopes)
		.map((setting) => ({
			corporationId: setting.corporationId,
			isConfigured: setting.esiAuthStatus?.isConfigured ?? false,
			hasRequiredScopes: setting.esiAuthStatus?.hasRequiredScopes ?? false,
			hasCorporationWalletScope: setting.esiAuthStatus?.hasCorporationWalletScope ?? false,
			missingRequiredScopes: setting.esiAuthStatus?.missingRequiredScopes ?? [],
			healthyDirectorCount: setting.esiAuthStatus?.healthyDirectorCount ?? 0,
			directorCount: setting.esiAuthStatus?.directorCount ?? 0,
			lastVerified: setting.esiAuthStatus?.lastVerified ?? null,
		})) as TaxMissingEsiKeyRow[]

	const exclusions = settings
		.filter((setting) => !setting.included)
		.map((setting) => ({
			corporationId: setting.corporationId,
			reason: setting.exclusionReason,
			createdBy: 'demo-admin',
			updatedBy: 'demo-admin',
			createdAt: setting.updatedAt,
			updatedAt: setting.updatedAt,
		})) as TaxCorporationExclusion[]

	const exports = [
		{
			id: 'export-1',
			corporationId: null,
			reportType: 'total_taxes_by_corporation',
			format: 'csv',
			status: 'completed',
			rowCount: corporations.length,
			requestedAt: addDays(demoStart, Math.max(0, demoDaySpan - 18)),
			completedAt: addDays(demoStart, Math.max(0, demoDaySpan - 18)),
			filters: null,
		},
	] as TaxExportRecord[]

	const schedules = [
		{
			id: 'schedule-1',
			name: 'Weekly Alliance Tax Overview',
			corporationId: null,
			reportType: 'total_taxes_by_corporation',
			format: 'csv',
			frequency: 'weekly',
			isActive: true,
			filters: null,
			nextRunAt: addDays(monthStart, 7),
			createdAt: addDays(demoStart, Math.max(0, demoDaySpan - 24)),
			updatedAt: addDays(demoStart, Math.max(0, demoDaySpan - 12)),
		},
	] as TaxExportSchedule[]

	const notificationDestinations = [
		{
			id: 'destination-1',
			name: 'Alliance Tax Alerts',
			guildId: '111111',
			channelId: '222222',
			createdByUserId: 'demo-admin',
			updatedByUserId: 'demo-admin',
			createdAt: addDays(demoStart, Math.max(0, demoDaySpan - 20)),
			updatedAt: addDays(demoStart, Math.max(0, demoDaySpan - 10)),
		},
	] as TaxNotificationDestination[]

	const defaultRuleGroupId = 'rule-group-default'
	const corpOverrideRuleGroupId = `rule-group-${corporations[0]?.corporationId ?? '99010001'}`

	const ruleGroups = [
		{
			id: defaultRuleGroupId,
			name: 'Alliance Global (default)',
			description: 'Default system alliance global group',
			isDefaultGlobal: true,
			isSystem: true,
			createdBy: 'demo-admin',
			createdAt: addDays(startOfMonth(), -30),
			updatedAt: addDays(startOfMonth(), -1),
		},
		{
			id: corpOverrideRuleGroupId,
			name: 'Corporation Overrides',
			description: 'Scoped overrides for selected corporation',
			isDefaultGlobal: false,
			isSystem: false,
			createdBy: 'demo-admin',
			createdAt: addDays(startOfMonth(), -14),
			updatedAt: addDays(startOfMonth(), -1),
		},
	] as TaxRuleGroup[]

	const ruleGroupAttachments = [
		{
			id: 'attach-1',
			ruleGroupId: defaultRuleGroupId,
			corporationId: corporations[0]?.corporationId ?? '99010001',
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: 'attach-2',
			ruleGroupId: defaultRuleGroupId,
			corporationId: corporations[1]?.corporationId ?? '99010002',
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: 'attach-3',
			ruleGroupId: corpOverrideRuleGroupId,
			corporationId: corporations[0]?.corporationId ?? '99010001',
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	] as TaxRuleGroupAttachment[]

	const ruleSets = [
		{
			id: 'rule-1',
			ruleGroupId: defaultRuleGroupId,
			name: 'Default Alliance Tax',
			priority: 0,
			isActive: true,
			appliesToRefType: null,
			taxRateBps: 500,
			createdBy: 'demo-admin',
			createdAt: addDays(startOfMonth(), -20),
			updatedAt: addDays(startOfMonth(), -5),
		},
		{
			id: 'rule-2',
			ruleGroupId: corpOverrideRuleGroupId,
			name: 'ESS Override',
			priority: 50,
			isActive: true,
			appliesToRefType: 'ess_escrow_transfer',
			taxRateBps: 950,
			createdBy: 'demo-admin',
			createdAt: addDays(startOfMonth(), -10),
			updatedAt: addDays(startOfMonth(), -2),
		},
	] as TaxRuleSet[]

	const billingConfigs = corporations.map((corp, index) => {
		const payeeType: 'character' | 'corporation' = index % 3 === 0 ? 'character' : 'corporation'
		return {
			id: `billing-config-${corp.corporationId}`,
			corporationId: corp.corporationId,
			isDefault: true,
			billingEnabled: index % 8 !== 0,
			billingIssuerUserId: '',
			billingPayeeId: payeeType === 'character' ? '70000001' : corp.corporationId,
			billingPayeeType: payeeType,
			billingDueDays: 14,
			createdAt: addDays(startOfMonth(), -14),
			updatedAt: addDays(startOfMonth(), -2),
		}
	}) as TaxCorporationBillingConfig[]

	return {
		seed,
		entityNames,
		settings,
		walletDivisions,
		discrepancies,
		ledgerEntries,
		memberSummary,
		assessments,
		billHistory,
		alerts,
		auditLog,
		missingEsi,
		exclusions,
		exports,
		schedules,
		notificationDestinations,
		ruleGroups,
		ruleGroupAttachments,
		ruleSets,
		billingConfigs,
	}
}

let demoState: DemoTaxState | null = null

function ensureDemoState(): DemoTaxState {
	if (!demoState) {
		const seed = readStoredSeed()
		demoState = buildDemoState(seed)
	}
	return demoState
}

function regenerateDemoState(seed = Date.now()): DemoTaxState {
	persistSeed(seed)
	demoState = buildDemoState(seed)
	return demoState
}

function updateDemoConfig(input?: Partial<DemoTaxConfig> | null): DemoTaxConfig {
	const next = sanitizeDemoConfig({ ...readStoredConfig(), ...input })
	persistConfig(next)
	return next
}

function filterLedgerEntries(rows: TaxLedgerEntry[], filters?: TaxReportFilters): TaxLedgerEntry[] {
	return rows.filter((row) => {
		if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
		if (!matchesDate(row.entryDate, filters?.fromDate, filters?.toDate)) return false
		return true
	})
}

function sortRows<T>(rows: T[], sortBy?: string, sortDir: 'asc' | 'desc' = 'asc'): T[] {
	if (!sortBy) return rows
	const direction = sortDir === 'desc' ? -1 : 1
	return [...rows].sort((left, right) => {
		const a = (left as Record<string, unknown>)[sortBy]
		const b = (right as Record<string, unknown>)[sortBy]
		if (a === b) return 0
		if (a == null) return 1
		if (b == null) return -1

		if (typeof a === 'number' && typeof b === 'number') {
			return a > b ? direction : -direction
		}

		const aNum = Number(a)
		const bNum = Number(b)
		if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
			if (aNum === bNum) return 0
			return aNum > bNum ? direction : -direction
		}

		const aDate = new Date(String(a)).getTime()
		const bDate = new Date(String(b)).getTime()
		if (Number.isFinite(aDate) && Number.isFinite(bDate)) {
			if (aDate === bDate) return 0
			return aDate > bDate ? direction : -direction
		}

		return String(a).localeCompare(String(b)) * direction
	})
}

function filterAssessments(rows: TaxAssessment[], filters?: TaxReportFilters): TaxAssessment[] {
	return rows.filter((row) => {
		if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
		if (!matchesDate(row.taxPeriodEnd, filters?.fromDate, filters?.toDate)) return false
		return true
	})
}

function deriveTotalTaxesRows(
	state: DemoTaxState,
	filters?: TaxReportFilters
): TaxTotalTaxesByCorporationRow[] {
	const ledgerRows = filterLedgerEntries(state.ledgerEntries, filters).filter(
		(row) => parseAmount(row.amount) > 0
	)
	const assessments = filterAssessments(state.assessments, filters)
	const ledgerByCorporation = new Map<
		string,
		{
			taxableItemCount: number
			taxableIncome: number
		}
	>()
	for (const row of ledgerRows) {
		const current = ledgerByCorporation.get(row.corporationId) ?? {
			taxableItemCount: 0,
			taxableIncome: 0,
		}
		current.taxableItemCount += 1
		current.taxableIncome += parseAmount(row.amount)
		ledgerByCorporation.set(row.corporationId, current)
	}

	const grouped = new Map<
		string,
		{
			taxableItemCount: number
			assessmentCount: number
			billedAssessmentCount: number
			underpaidCount: number
			paidCount: number
			overpaidCount: number
			draftCount: number
			excludedCount: number
			taxableIncome: number
			taxDue: number
			taxPaid: number
			taxDelta: number
			lastAssessmentAt: Date | null
		}
	>()

	for (const row of assessments) {
		const ledger = ledgerByCorporation.get(row.corporationId)
		const current = grouped.get(row.corporationId) ?? {
			taxableItemCount: ledger?.taxableItemCount ?? 0,
			assessmentCount: 0,
			billedAssessmentCount: 0,
			underpaidCount: 0,
			paidCount: 0,
			overpaidCount: 0,
			draftCount: 0,
			excludedCount: 0,
			taxableIncome: ledger?.taxableIncome ?? 0,
			taxDue: 0,
			taxPaid: 0,
			taxDelta: 0,
			lastAssessmentAt: null,
		}
		current.assessmentCount += 1
		current.billedAssessmentCount += row.billId ? 1 : 0
		current.underpaidCount += row.status === 'underpaid' ? 1 : 0
		current.paidCount += row.status === 'paid' ? 1 : 0
		current.overpaidCount += row.status === 'overpaid' ? 1 : 0
		current.draftCount += row.status === 'draft' ? 1 : 0
		current.excludedCount += row.status === 'excluded' ? 1 : 0
		current.taxDue += parseAmount(row.taxDue)
		current.taxDelta += parseAmount(row.taxDelta)
		current.taxPaid += parseAmount(row.taxDue) - parseAmount(row.taxDelta)
		if (!current.lastAssessmentAt || row.taxPeriodEnd > current.lastAssessmentAt) {
			current.lastAssessmentAt = row.taxPeriodEnd
		}
		grouped.set(row.corporationId, current)
	}

	for (const [corporationId, ledger] of ledgerByCorporation.entries()) {
		if (!grouped.has(corporationId)) {
			grouped.set(corporationId, {
				taxableItemCount: ledger.taxableItemCount,
				assessmentCount: 0,
				billedAssessmentCount: 0,
				underpaidCount: 0,
				paidCount: 0,
				overpaidCount: 0,
				draftCount: 0,
				excludedCount: 0,
				taxableIncome: ledger.taxableIncome,
				taxDue: 0,
				taxPaid: 0,
				taxDelta: 0,
				lastAssessmentAt: null,
			})
		}
	}

	return Array.from(grouped.entries()).map(([corporationId, row]) => ({
		corporationId,
		taxableItemCount: row.taxableItemCount,
		assessmentCount: row.assessmentCount,
		billedAssessmentCount: row.billedAssessmentCount,
		underpaidCount: row.underpaidCount,
		paidCount: row.paidCount,
		overpaidCount: row.overpaidCount,
		draftCount: row.draftCount,
		excludedCount: row.excludedCount,
		taxableIncome: amount(row.taxableIncome),
		taxDue: amount(row.taxDue),
		taxPaid: amount(row.taxPaid),
		taxDelta: amount(row.taxDelta),
		taxDueCenti: String(Math.round(row.taxDue * 100)),
		taxPaidCenti: String(Math.round(row.taxPaid * 100)),
		taxDeltaCenti: String(Math.round(row.taxDelta * 100)),
		lastAssessmentAt: row.lastAssessmentAt,
	}))
}

function deriveTopIncomeRows(
	state: DemoTaxState,
	filters?: TaxReportFilters
): TaxTopIncomeSourceRow[] {
	const grouped = new Map<
		string,
		{ refType: string; entryCount: number; essEntryCount: number; totalIncome: number }
	>()
	for (const row of filterLedgerEntries(state.ledgerEntries, filters)) {
		const amountValue = parseAmount(row.amount)
		if (amountValue <= 0) continue
		const current = grouped.get(row.refType) ?? {
			refType: row.refType,
			entryCount: 0,
			essEntryCount: 0,
			totalIncome: 0,
		}
		current.entryCount += 1
		current.essEntryCount += row.refType === 'ess_escrow_transfer' ? 1 : 0
		current.totalIncome += amountValue
		grouped.set(row.refType, current)
	}
	return Array.from(grouped.values())
		.sort((a, b) => b.totalIncome - a.totalIncome)
		.map((row) => ({
			refType: row.refType,
			entryCount: row.entryCount,
			essEntryCount: row.essEntryCount,
			totalIncome: amount(row.totalIncome),
		}))
}

function deriveEssRows(state: DemoTaxState, filters?: TaxReportFilters): TaxEssPayoutRow[] {
	return filterLedgerEntries(state.ledgerEntries, filters)
		.filter((row) => row.refType === 'ess_escrow_transfer')
		.map((row) => ({
			id: row.id,
			corporationId: row.corporationId,
			entryDate: row.entryDate,
			division: row.division,
			amount: row.amount,
			sourceType: row.sourceType,
			sourcePrimaryId: row.sourcePrimaryId,
			firstPartyId: row.firstPartyId,
			secondPartyId: row.secondPartyId,
		}))
}

function deriveComplianceRows(
	state: DemoTaxState,
	filters?: TaxReportFilters
): TaxCompliancePoint[] {
	const grouped = new Map<
		string,
		{ rollupDate: Date; taxDue: number; taxPaid: number; taxDelta: number; entryCount: number }
	>()
	for (const row of filterAssessments(state.assessments, filters)) {
		const rollupDate = new Date(
			Date.UTC(row.taxPeriodEnd.getUTCFullYear(), row.taxPeriodEnd.getUTCMonth(), 1)
		)
		const key = rollupDate.toISOString()
		const current = grouped.get(key) ?? {
			rollupDate,
			taxDue: 0,
			taxPaid: 0,
			taxDelta: 0,
			entryCount: 0,
		}
		current.taxDue += parseAmount(row.taxDue)
		current.taxDelta += parseAmount(row.taxDelta)
		current.taxPaid += parseAmount(row.taxDue) - parseAmount(row.taxDelta)
		current.entryCount += 1
		grouped.set(key, current)
	}
	return Array.from(grouped.values())
		.sort((a, b) => a.rollupDate.getTime() - b.rollupDate.getTime())
		.map((row) => ({
			rollupDate: row.rollupDate,
			taxDue: amount(row.taxDue),
			taxPaid: amount(row.taxPaid),
			taxDelta: amount(row.taxDelta),
			entryCount: row.entryCount,
		}))
}

function deriveBillStatusRows(
	state: DemoTaxState,
	filters?: TaxReportFilters
): TaxBillStatusReportRow[] {
	return filterAssessments(state.assessments, filters)
		.filter((row) => Boolean(row.billId))
		.map((row) => {
			const taxDue = parseAmount(row.taxDue)
			const taxDelta = parseAmount(row.taxDelta)
			const taxPaid = taxDue - taxDelta
			return {
				assessmentId: row.id,
				corporationId: row.corporationId,
				taxPeriodStart: row.taxPeriodStart,
				taxPeriodEnd: row.taxPeriodEnd,
				billId: row.billId,
				billStatus: row.billStatus ?? 'draft',
				issueDate: row.billId ? row.createdAt : null,
				dueDate: row.billId ? addDays(row.taxPeriodEnd, 14) : null,
				taxDue: row.taxDue,
				taxPaid: amount(taxPaid),
				taxDelta: row.taxDelta,
				taxDueCenti: String(Math.round(taxDue * 100)),
				taxPaidCenti: String(Math.round(taxPaid * 100)),
				taxDeltaCenti: String(Math.round(taxDelta * 100)),
			}
		})
}

function buildSummary(
	rows: TaxTotalTaxesByCorporationRow[],
	filters?: TaxReportFilters
): TaxSummaryReport {
	const taxDue = rows.reduce((sum, row) => sum + parseAmount(row.taxDue), 0)
	const taxPaid = rows.reduce((sum, row) => sum + parseAmount(row.taxPaid), 0)
	const assessments = rows.reduce((sum, row) => sum + row.assessmentCount, 0)
	return {
		corporationId: rows.length === 1 ? rows[0]!.corporationId : null,
		fromDate: filters?.fromDate ? new Date(filters.fromDate) : startOfMonth(),
		toDate: filters?.toDate ? new Date(filters.toDate) : addDays(startOfMonth(), 29),
		taxDue: amount(taxDue),
		taxPaid: amount(taxPaid),
		taxDelta: amount(taxDue - taxPaid),
		assessmentCount: assessments,
		discrepancyOpenCount: 2,
		includedCorporationCount: rows.length,
		excludedCorporationCount: 1,
		billedAssessmentCount: rows.reduce((sum, row) => sum + row.billedAssessmentCount, 0),
		taxableIncome: amount(taxDue * 10),
		essIncome: amount(taxDue * 0.18),
		essTransferCount: 10,
	} as TaxSummaryReport
}

export function isTaxDemoModeEnabled(): boolean {
	return readEnabled()
}

export function resolveDemoEntityNames(ids: string[]): Record<string, string> {
	const state = ensureDemoState()
	const result: Record<string, string> = {}
	for (const id of ids) {
		if (state.entityNames[id]) result[id] = state.entityNames[id]
	}
	return result
}

export const taxDemoApi = {
	async getCapabilities(corporationId?: string): Promise<TaxCapabilitiesResponse> {
		return withLatency({
			corporationId: corporationId ?? null,
			global: { canRead: true, canAudit: true, canManage: true },
			scoped: { canRead: true, canAudit: true, canManage: true },
		})
	},
	async listCorporations(filters?: { limit?: number; offset?: number }) {
		const rows = ensureDemoState().settings
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async listWalletDivisions(corporationId: string) {
		return withLatency(ensureDemoState().walletDivisions[corporationId] ?? [])
	},
	async listExclusions(filters?: { limit?: number; offset?: number }) {
		return withLatency(
			applyLimitOffset(ensureDemoState().exclusions, filters?.limit, filters?.offset)
		)
	},
	async upsertExclusion(corporationId: string, input: { reason: string | null }) {
		const state = ensureDemoState()
		const now = new Date()
		const existing = state.exclusions.find((row) => row.corporationId === corporationId)
		if (existing) {
			existing.reason = input.reason
			existing.updatedAt = now
			existing.updatedBy = 'demo-admin'
		} else {
			state.exclusions.push({
				corporationId,
				reason: input.reason,
				createdBy: 'demo-admin',
				updatedBy: 'demo-admin',
				createdAt: now,
				updatedAt: now,
			})
		}
		const setting = state.settings.find((row) => row.corporationId === corporationId)
		if (setting) {
			setting.included = false
			setting.exclusionReason = input.reason
			setting.updatedAt = now
		}
		return withLatency(
			state.exclusions.find((row) => row.corporationId === corporationId) ?? state.exclusions[0]!
		)
	},
	async deleteExclusion(corporationId: string) {
		const state = ensureDemoState()
		state.exclusions = state.exclusions.filter((row) => row.corporationId !== corporationId)
		const setting = state.settings.find((row) => row.corporationId === corporationId)
		if (setting) {
			setting.included = true
			setting.exclusionReason = null
			setting.updatedAt = new Date()
		}
		return withLatency(undefined)
	},
	async listRuleSets(filters?: { corporationId?: string; ruleGroupId?: string }) {
		const state = ensureDemoState()
		let filtered = [...state.ruleSets]
		if (filters?.ruleGroupId) {
			filtered = filtered.filter((rule) => rule.ruleGroupId === filters.ruleGroupId)
		} else if (filters?.corporationId) {
			const allowedRuleGroupIds = new Set(
				state.ruleGroupAttachments
					.filter((attachment) => attachment.corporationId === filters.corporationId)
					.map((attachment) => attachment.ruleGroupId)
			)
			filtered = filtered.filter((rule) => allowedRuleGroupIds.has(rule.ruleGroupId))
		}
		return withLatency(filtered)
	},
	async createRuleSet(
		_corporationId: string | undefined,
		input: {
			name: string
			ruleGroupId: string
			priority?: number
			isActive?: boolean
			appliesToRefType?: string
			taxRateBps: number
		}
	) {
		const state = ensureDemoState()
		const created = {
			id: `rule-${Date.now()}`,
			ruleGroupId: input.ruleGroupId,
			name: input.name,
			priority: input.priority ?? 0,
			isActive: input.isActive ?? true,
			appliesToRefType: input.appliesToRefType ?? null,
			taxRateBps: input.taxRateBps,
			createdBy: 'demo-admin',
			createdAt: new Date(),
			updatedAt: new Date(),
		} as TaxRuleSet
		state.ruleSets.unshift(created)
		return withLatency(created)
	},
	async updateRuleSet(
		ruleSetId: string,
		input: {
			isActive?: boolean
			name?: string
			priority?: number
			appliesToRefType?: string | null
			taxRateBps?: number
		}
	) {
		const state = ensureDemoState()
		const existing = state.ruleSets.find((row) => row.id === ruleSetId)
		if (!existing) {
			const fallback = {
				id: ruleSetId,
				ruleGroupId: 'rule-group-default',
				name: input.name ?? 'Demo Rule',
				priority: input.priority ?? 100,
				isActive: input.isActive ?? true,
				appliesToRefType: input.appliesToRefType ?? null,
				taxRateBps: input.taxRateBps ?? 750,
				createdBy: 'demo-admin',
				createdAt: new Date(),
				updatedAt: new Date(),
			} as TaxRuleSet
			state.ruleSets.unshift(fallback)
			return withLatency(fallback)
		}

		existing.name = input.name ?? existing.name
		existing.priority = input.priority ?? existing.priority
		existing.isActive = input.isActive ?? existing.isActive
		if (input.appliesToRefType !== undefined) {
			existing.appliesToRefType = input.appliesToRefType
		}
		existing.taxRateBps = input.taxRateBps ?? existing.taxRateBps
		existing.updatedAt = new Date()

		return withLatency(existing)
	},
	async deleteRuleSet(ruleSetId: string) {
		const state = ensureDemoState()
		state.ruleSets = state.ruleSets.filter((row) => row.id !== ruleSetId)
		return withLatency(undefined)
	},
	async listRuleGroups(filters?: { corporationId?: string }) {
		const state = ensureDemoState()
		let rows = [...state.ruleGroups]
		if (filters?.corporationId) {
			const allowedRuleGroupIds = new Set(
				state.ruleGroupAttachments
					.filter((attachment) => attachment.corporationId === filters.corporationId)
					.map((attachment) => attachment.ruleGroupId)
			)
			rows = rows.filter((group) => allowedRuleGroupIds.has(group.id))
		}
		return withLatency(rows)
	},
	async createRuleGroup(input: { name: string; description?: string | null }) {
		const state = ensureDemoState()
		const created: TaxRuleGroup = {
			id: `rule-group-${Date.now()}`,
			name: input.name,
			description: input.description ?? null,
			isDefaultGlobal: false,
			isSystem: false,
			createdBy: 'demo-admin',
			createdAt: new Date(),
			updatedAt: new Date(),
		}
		state.ruleGroups.unshift(created)
		return withLatency(created)
	},
	async updateRuleGroup(
		ruleGroupId: string,
		input: { name?: string; description?: string | null }
	) {
		const state = ensureDemoState()
		const existing = state.ruleGroups.find((row) => row.id === ruleGroupId)
		if (!existing) {
			const fallback: TaxRuleGroup = {
				id: ruleGroupId,
				name: input.name ?? 'Updated Demo Rule Group',
				description: input.description ?? null,
				isDefaultGlobal: false,
				isSystem: false,
				createdBy: 'demo-admin',
				createdAt: addDays(startOfMonth(), -10),
				updatedAt: new Date(),
			}
			state.ruleGroups.unshift(fallback)
			return withLatency(fallback)
		}
		if (existing.isDefaultGlobal || existing.isSystem) {
			return withLatency(existing)
		}
		existing.name = input.name ?? existing.name
		existing.description = input.description ?? existing.description
		existing.updatedAt = new Date()
		return withLatency(existing)
	},
	async deleteRuleGroup(ruleGroupId: string) {
		const state = ensureDemoState()
		const group = state.ruleGroups.find((row) => row.id === ruleGroupId)
		if (group?.isDefaultGlobal || group?.isSystem) {
			return withLatency(undefined)
		}
		state.ruleGroups = state.ruleGroups.filter((row) => row.id !== ruleGroupId)
		state.ruleGroupAttachments = state.ruleGroupAttachments.filter(
			(row) => row.ruleGroupId !== ruleGroupId
		)
		state.ruleSets = state.ruleSets.filter((row) => row.ruleGroupId !== ruleGroupId)
		return withLatency(undefined)
	},
	async listRuleGroupAttachments(ruleGroupId: string) {
		const state = ensureDemoState()
		const rows = state.ruleGroupAttachments
			.filter((row) => row.ruleGroupId === ruleGroupId)
			.sort((left, right) => {
				const leftTime = new Date(left.createdAt).getTime()
				const rightTime = new Date(right.createdAt).getTime()
				if (leftTime !== rightTime) return leftTime - rightTime
				return left.corporationId.localeCompare(right.corporationId)
			})
		return withLatency(rows)
	},
	async attachCorporationToRuleGroup(ruleGroupId: string, corporationId: string) {
		const state = ensureDemoState()
		const existing = state.ruleGroupAttachments.find(
			(row) => row.ruleGroupId === ruleGroupId && row.corporationId === corporationId
		)
		if (existing) return withLatency(existing)

		if (!state.settings.some((row) => row.corporationId === corporationId)) {
			const template = state.settings[0]
			if (template) {
				const now = new Date()
				state.settings.unshift({
					...template,
					corporationId,
					updatedAt: now,
					createdAt: now,
					exclusionReason: null,
					included: true,
				})
			}
			if (!(corporationId in state.walletDivisions)) {
				state.walletDivisions[corporationId] = []
			}
		}
		const row: TaxRuleGroupAttachment = {
			id: `attach-${Date.now()}`,
			ruleGroupId,
			corporationId,
			createdAt: new Date(),
			updatedAt: new Date(),
		}
		state.ruleGroupAttachments.unshift(row)
		return withLatency(row)
	},
	async detachCorporationFromRuleGroup(ruleGroupId: string, corporationId: string) {
		const state = ensureDemoState()
		state.ruleGroupAttachments = state.ruleGroupAttachments.filter(
			(row) => !(row.ruleGroupId === ruleGroupId && row.corporationId === corporationId)
		)
		return withLatency(undefined)
	},
	async listAssessments(
		corporationId: string,
		filters?: {
			status?: string
			assessmentScope?: string
			withBillOnly?: boolean
			limit?: number
			offset?: number
		}
	) {
		const rows = ensureDemoState().assessments.filter((row) => {
			if (row.corporationId !== corporationId) return false
			if (filters?.status && row.status !== filters.status) return false
			if (filters?.assessmentScope && row.assessmentScope !== filters.assessmentScope) return false
			if (filters?.withBillOnly && !row.billId) return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getLedgerEntries(
		corporationId: string,
		filters?: TaxReportFilters & { sourceTypes?: string[]; characterId?: string }
	) {
		const rows = filterLedgerEntries(
			ensureDemoState().ledgerEntries.filter((row) => row.corporationId === corporationId),
			filters
		).filter((row) => {
			if (filters?.sourceTypes?.length && !filters.sourceTypes.includes(row.sourceType))
				return false
			if ((filters as any)?.characterId && row.characterId !== (filters as any).characterId)
				return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getLedgerParties(
		corporationId: string,
		filters?: {
			fromDate?: string
			toDate?: string
			limit?: number
			q?: string
			direction?: 'any' | 'sender' | 'recipient'
		}
	) {
		const scoped = filterLedgerEntries(
			ensureDemoState().ledgerEntries.filter((row) => row.corporationId === corporationId),
			{
				fromDate: filters?.fromDate,
				toDate: filters?.toDate,
			}
		)
		const byId = new Map<
			string,
			{
				entityId: string
				entityName: string | null
				senderCount: number
				recipientCount: number
				lastSeenAt: Date
			}
		>()
		const entityNames = ensureDemoState().entityNames

		for (const row of scoped) {
			const seenAt = new Date(row.entryDate)
			const senderId = row.firstPartyId ?? undefined
			const recipientId = row.secondPartyId ?? undefined

			if (senderId) {
				const current = byId.get(senderId) ?? {
					entityId: senderId,
					entityName: entityNames[senderId] ?? null,
					senderCount: 0,
					recipientCount: 0,
					lastSeenAt: seenAt,
				}
				current.senderCount += 1
				if (seenAt > current.lastSeenAt) current.lastSeenAt = seenAt
				byId.set(senderId, current)
			}
			if (recipientId) {
				const current = byId.get(recipientId) ?? {
					entityId: recipientId,
					entityName: entityNames[recipientId] ?? null,
					senderCount: 0,
					recipientCount: 0,
					lastSeenAt: seenAt,
				}
				current.recipientCount += 1
				if (seenAt > current.lastSeenAt) current.lastSeenAt = seenAt
				byId.set(recipientId, current)
			}
		}

		const query = filters?.q?.trim().toLowerCase()
		const direction = filters?.direction ?? 'any'
		const rows = Array.from(byId.values())
			.filter((row) => {
				if (direction === 'sender') return row.senderCount > 0
				if (direction === 'recipient') return row.recipientCount > 0
				return true
			})
			.filter((row) => {
				if (!query) return true
				return (
					row.entityId.toLowerCase().includes(query) ||
					row.entityName?.toLowerCase().includes(query)
				)
			})
			.sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
			.map((row) => ({
				entityId: row.entityId,
				entityName: row.entityName,
				lastSeenAt: row.lastSeenAt,
			}))

		return withLatency(rows.slice(0, filters?.limit ?? 500))
	},
	async listBillingConfigs(corporationId: string) {
		const rows = ensureDemoState()
			.billingConfigs.filter((row) => row.corporationId === corporationId)
			.sort((left, right) => {
				if (left.isDefault !== right.isDefault) {
					return left.isDefault ? -1 : 1
				}
				return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
			})
		return withLatency(rows)
	},
	async createBillingConfig(corporationId: string, input: CreateTaxCorporationBillingConfigInput) {
		const state = ensureDemoState()
		const existing = state.billingConfigs.filter((row) => row.corporationId === corporationId)
		const makeDefault = input.isDefault ?? existing.length === 0
		if (makeDefault) {
			for (const row of existing) {
				row.isDefault = false
				row.updatedAt = new Date()
			}
		}
		const created: TaxCorporationBillingConfig = {
			id: `billing-config-${Date.now()}`,
			corporationId,
			isDefault: makeDefault,
			billingEnabled: input.billingEnabled ?? false,
			billingIssuerUserId: input.billingIssuerUserId?.trim() ?? '',
			billingPayeeId: input.billingPayeeId?.trim() ?? '',
			billingPayeeType: input.billingPayeeType ?? 'corporation',
			billingDueDays: input.billingDueDays ?? 14,
			createdAt: new Date(),
			updatedAt: new Date(),
		}
		state.billingConfigs.unshift(created)
		return withLatency(created)
	},
	async updateBillingConfig(
		corporationId: string,
		configId: string,
		input: UpdateTaxCorporationBillingConfigInput
	) {
		const state = ensureDemoState()
		const existing = state.billingConfigs.find(
			(row) => row.id === configId && row.corporationId === corporationId
		)
		if (!existing) {
			throw new Error('Billing configuration not found')
		}
		if (input.isDefault) {
			for (const row of state.billingConfigs) {
				if (row.corporationId === corporationId) {
					row.isDefault = false
				}
			}
		}
		existing.isDefault = input.isDefault ?? existing.isDefault
		existing.billingEnabled = input.billingEnabled ?? existing.billingEnabled
		existing.billingIssuerUserId = input.billingIssuerUserId?.trim() ?? existing.billingIssuerUserId
		existing.billingPayeeId = input.billingPayeeId?.trim() ?? existing.billingPayeeId
		existing.billingPayeeType = input.billingPayeeType ?? existing.billingPayeeType
		existing.billingDueDays = input.billingDueDays ?? existing.billingDueDays
		existing.updatedAt = new Date()
		return withLatency(existing)
	},
	async deleteBillingConfig(corporationId: string, configId: string) {
		const state = ensureDemoState()
		const existing = state.billingConfigs.find(
			(row) => row.id === configId && row.corporationId === corporationId
		)
		if (!existing) {
			throw new Error('Billing configuration not found')
		}
		state.billingConfigs = state.billingConfigs.filter((row) => row.id !== configId)
		const remaining = state.billingConfigs.filter((row) => row.corporationId === corporationId)
		if (remaining.length > 0 && !remaining.some((row) => row.isDefault)) {
			remaining[0]!.isDefault = true
			remaining[0]!.updatedAt = new Date()
		}
		return withLatency(undefined)
	},
	async setDefaultBillingConfig(corporationId: string, configId: string) {
		const state = ensureDemoState()
		const existing = state.billingConfigs.find(
			(row) => row.id === configId && row.corporationId === corporationId
		)
		if (!existing) {
			throw new Error('Billing configuration not found')
		}
		for (const row of state.billingConfigs) {
			if (row.corporationId === corporationId) {
				row.isDefault = false
			}
		}
		existing.isDefault = true
		existing.updatedAt = new Date()
		return withLatency(existing)
	},
	async createBillForAssessment(corporationId: string, assessmentId: string) {
		const state = ensureDemoState()
		const assessment = state.assessments.find(
			(row) => row.id === assessmentId && row.corporationId === corporationId
		)
		if (assessment) {
			assessment.billId = assessment.billId ?? `bill-${assessmentId}`
			assessment.billStatus = 'issued' as any
		}
		rebuildDemoBillHistory(state)
		return withLatency(assessment ?? ensureDemoState().assessments[0]!)
	},
	async syncAssessmentBillStatus(corporationId: string, assessmentId: string) {
		const state = ensureDemoState()
		const assessment = state.assessments.find(
			(row) => row.id === assessmentId && row.corporationId === corporationId
		)
		if (assessment?.billId) {
			assessment.billStatus = 'paid' as any
			assessment.taxDelta = amount(0)
			assessment.status = 'paid' as any
		}
		rebuildDemoBillHistory(state)
		return withLatency(assessment ?? ensureDemoState().assessments[0]!)
	},
	async retractAssessmentBill(corporationId: string, assessmentId: string) {
		const state = ensureDemoState()
		const assessment = state.assessments.find(
			(row) => row.id === assessmentId && row.corporationId === corporationId
		)
		if (assessment?.billId) {
			assessment.billStatus = 'cancelled' as any
		}
		rebuildDemoBillHistory(state)
		return withLatency(assessment ?? ensureDemoState().assessments[0]!)
	},
	async issueBillsForPeriod(corporationId: string): Promise<IssueBillsForPeriodResult> {
		const state = ensureDemoState()
		const issued = state.assessments
			.filter((row) => row.corporationId === corporationId && !row.billId)
			.map((row) => {
				row.billId = `bill-${row.id}`
				row.billStatus = 'issued' as any
				return row.id
			})
		rebuildDemoBillHistory(state)
		return withLatency({
			corporationId,
			periodStart: startOfMonth(),
			periodEnd: addDays(startOfMonth(), 29),
			issuedAssessmentIds: issued,
			skippedAssessmentIds: [],
		} as IssueBillsForPeriodResult)
	},
	async syncCorporationBillStatuses(
		corporationId: string
	): Promise<SyncCorporationBillStatusesResult> {
		const state = ensureDemoState()
		const rows = state.assessments.filter((row) => row.corporationId === corporationId)
		const updated = rows
			.filter((row) => row.billId)
			.slice(0, 2)
			.map((row) => {
				row.billStatus = 'paid' as any
				row.taxDelta = amount(0)
				return row.id
			})
		rebuildDemoBillHistory(state)
		return withLatency({
			processedAssessmentIds: rows.map((row) => row.id),
			updatedAssessmentIds: updated,
			skippedAssessmentIds: rows.filter((row) => !updated.includes(row.id)).map((row) => row.id),
		} as SyncCorporationBillStatusesResult)
	},
	async listAlerts(filters?: {
		corporationId?: string
		status?: TaxAlertStatus
		severity?: TaxAlertSeverity
		limit?: number
		offset?: number
	}) {
		const rows = ensureDemoState().alerts.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			if (filters?.status && row.status !== filters.status) return false
			if (filters?.severity && row.severity !== filters.severity) return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async acknowledgeAlert(alertId: string) {
		const row = ensureDemoState().alerts.find((alert) => alert.id === alertId)
		if (row) row.status = 'acknowledged'
		return withLatency(row ?? ensureDemoState().alerts[0]!)
	},
	async resolveAlert(alertId: string) {
		const row = ensureDemoState().alerts.find((alert) => alert.id === alertId)
		if (row) row.status = 'resolved'
		return withLatency(row ?? ensureDemoState().alerts[0]!)
	},
	async retryFailedAlertDeliveries() {
		return withLatency({
			retried: ensureDemoState().alerts.filter((row) => row.discordDeliveryStatus === 'failed')
				.length,
		})
	},
	async getBillStatusReport(
		filters?: TaxReportFilters
	): Promise<TaxPagedResult<TaxBillStatusReportRow>> {
		const rows = sortRows(
			deriveBillStatusRows(ensureDemoState(), filters),
			filters?.sortBy,
			filters?.sortDir
		)
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getCorporationBillHistory(
		corporationId: string,
		filters?: { limit?: number; offset?: number }
	) {
		return withLatency(
			applyLimitOffset(
				ensureDemoState().billHistory.filter(
					(row) => row.assessment?.corporationId === corporationId
				),
				filters?.limit,
				filters?.offset
			)
		)
	},
	async getCorporationBillEventHistory(
		corporationId: string,
		filters?: { limit?: number; offset?: number }
	): Promise<TaxPagedResult<TaxBillingEventHistoryRow>> {
		const rows = ensureDemoState()
			.billHistory.filter((row) => row.assessment?.corporationId === corporationId)
			.flatMap((row) =>
				(row.timeline ?? []).map((event) => ({
					id: event.id,
					billId: event.billId,
					assessmentId: row.assessment.id,
					eventType: event.eventType,
					fromStatus: event.fromStatus,
					toStatus: event.toStatus,
					actorUserId: event.actorUserId,
					metadata: event.metadata,
					createdAt: event.createdAt,
				}))
			)
			.sort(
				(left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
			)
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getSummaryReport(filters?: TaxReportFilters) {
		const rows = deriveTotalTaxesRows(ensureDemoState(), filters)
		return withLatency(buildSummary(rows, filters))
	},
	async getTotalTaxesReport(filters?: TaxReportFilters) {
		let rows = deriveTotalTaxesRows(ensureDemoState(), filters)
		rows = sortRows(rows, filters?.sortBy, filters?.sortDir)
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getTopIncomeSourcesReport(filters?: TaxReportFilters) {
		const rows = deriveTopIncomeRows(ensureDemoState(), filters)
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getTopIncomeSourcesMonthlyReport(filters?: TaxReportFilters) {
		const rows = filterLedgerEntries(ensureDemoState().ledgerEntries, filters)
		const grouped = new Map<
			string,
			{
				monthStart: Date
				refType: string
				entryCount: number
				essEntryCount: number
				totalIncome: number
			}
		>()
		for (const row of rows) {
			const amount = parseAmount(row.amount)
			if (amount <= 0) continue
			const monthStart = new Date(
				Date.UTC(row.entryDate.getUTCFullYear(), row.entryDate.getUTCMonth(), 1)
			)
			const monthKey = monthStart.toISOString().slice(0, 10)
			const key = `${monthKey}:${row.refType}`
			const current = grouped.get(key) ?? {
				monthStart,
				refType: row.refType,
				entryCount: 0,
				essEntryCount: 0,
				totalIncome: 0,
			}
			current.entryCount += 1
			current.essEntryCount += row.refType === 'ess_escrow_transfer' ? 1 : 0
			current.totalIncome += amount
			grouped.set(key, current)
		}
		const result = Array.from(grouped.values())
			.sort((a, b) => {
				const monthDiff = a.monthStart.getTime() - b.monthStart.getTime()
				if (monthDiff !== 0) return monthDiff
				if (a.totalIncome !== b.totalIncome) return b.totalIncome - a.totalIncome
				return a.refType.localeCompare(b.refType)
			})
			.map(
				(row) =>
					({
						monthStart: row.monthStart,
						refType: row.refType,
						entryCount: row.entryCount,
						essEntryCount: row.essEntryCount,
						totalIncome: amount(row.totalIncome),
					}) satisfies TaxTopIncomeSourceMonthlyRow
			)
		return withLatency(result)
	},
	async getEssPayoutReport(filters?: TaxReportFilters) {
		let rows = deriveEssRows(ensureDemoState(), filters)
		rows = sortRows(rows as any, filters?.sortBy, filters?.sortDir) as TaxEssPayoutRow[]
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getComplianceReport(filters?: TaxReportFilters) {
		const rows = deriveComplianceRows(ensureDemoState(), filters)
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getDiscrepancyReport(filters?: {
		corporationId?: string
		fromDate?: string
		toDate?: string
		onlyOpen?: boolean
		limit?: number
		offset?: number
		sortBy?: string
		sortDir?: 'asc' | 'desc'
	}) {
		let rows = ensureDemoState().discrepancies.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			if (!matchesDate(row.createdAt, filters?.fromDate, filters?.toDate)) return false
			if (filters?.onlyOpen && row.resolvedAt) return false
			return true
		})
		rows = sortRows(rows as any, filters?.sortBy, filters?.sortDir) as TaxDiscrepancy[]
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getMissingEsiKeysReport(filters?: {
		limit?: number
		offset?: number
		sortBy?: string
		sortDir?: 'asc' | 'desc'
	}) {
		let rows = ensureDemoState().missingEsi
		rows = sortRows(rows as any, filters?.sortBy, filters?.sortDir) as typeof rows
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getMemberSummary(
		corporationId: string,
		filters?: {
			characterQuery?: string
			limit?: number
			offset?: number
			sortBy?:
				| 'characterId'
				| 'contributionIncome'
				| 'taxableContributionIncome'
				| 'assessmentCount'
				| 'lastAssessmentAt'
			sortDir?: 'asc' | 'desc'
		}
	) {
		if (!corporationId?.trim()) {
			throw new Error('Corporation id is required for member summary')
		}
		const query = filters?.characterQuery?.trim()
		let rows = ensureDemoState().memberSummary.filter((row) => {
			if (row.corporationId !== corporationId) return false
			if (query) {
				const isNumeric = /^\d+$/.test(query)
				if (isNumeric) {
					if (row.characterId !== query) return false
				} else if (!row.characterId.startsWith('__')) {
					const haystack = `${row.characterId}`.toLowerCase()
					if (!haystack.startsWith(query.toLowerCase())) return false
				}
			}
			return true
		})
		rows = sortRows(rows as any, filters?.sortBy, filters?.sortDir ?? 'desc') as TaxMemberSummary[]
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async requestExport(input: {
		corporationId?: string
		format: TaxExportFormat
		reportType: any
		filters?: Record<string, unknown> | null
	}) {
		const record = {
			id: `export-${Date.now()}`,
			corporationId: input.corporationId ?? null,
			reportType: input.reportType,
			format: input.format,
			status: 'completed',
			rowCount: 24,
			requestedAt: new Date(),
			completedAt: new Date(),
			filters: input.filters ?? null,
		} as TaxExportRecord
		ensureDemoState().exports.unshift(record)
		return withLatency(record)
	},
	async listExports(filters?: {
		corporationId?: string
		format?: TaxExportFormat
		status?: TaxExportStatus
		limit?: number
		offset?: number
	}) {
		const rows = ensureDemoState().exports.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			if (filters?.format && row.format !== filters.format) return false
			if (filters?.status && row.status !== filters.status) return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getExportArtifact(exportId: string) {
		const record =
			ensureDemoState().exports.find((row) => row.id === exportId) ?? ensureDemoState().exports[0]!
		const csv = 'corporation,tax_due,tax_paid\\nOrion Industrial,2450000000.00,2360000000.00\\n'
		return withLatency({
			exportId: record.id,
			fileName: `demo-${record.reportType}.${record.format === 'xlsx' ? 'csv' : record.format}`,
			contentType: 'text/csv',
			contentBase64: window.btoa(csv),
		} as TaxExportArtifact)
	},
	async createExportSchedule(input: {
		name: string
		corporationId?: string
		format: TaxExportFormat
		frequency: 'weekly' | 'monthly'
		reportType: any
		filters?: Record<string, unknown> | null
		nextRunAt?: string
		isActive?: boolean
	}) {
		const schedule = {
			id: `schedule-${Date.now()}`,
			name: input.name,
			corporationId: input.corporationId ?? null,
			reportType: input.reportType,
			format: input.format,
			frequency: input.frequency,
			isActive: input.isActive ?? true,
			filters: input.filters ?? null,
			nextRunAt: input.nextRunAt ? new Date(input.nextRunAt) : addDays(new Date(), 7),
			createdAt: new Date(),
			updatedAt: new Date(),
		} as TaxExportSchedule
		ensureDemoState().schedules.unshift(schedule)
		return withLatency(schedule)
	},
	async listExportSchedules(filters?: {
		corporationId?: string
		activeOnly?: boolean
		limit?: number
		offset?: number
	}) {
		const rows = ensureDemoState().schedules.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			if (filters?.activeOnly && !row.isActive) return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async listAuditLog(filters?: {
		corporationId?: string
		actorUserId?: string
		action?: string
		fromDate?: string
		toDate?: string
		limit?: number
		offset?: number
	}) {
		const rows = ensureDemoState().auditLog.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			if (filters?.actorUserId && row.actorUserId !== filters.actorUserId) return false
			if (filters?.action && !row.action.toLowerCase().includes(filters.action.toLowerCase()))
				return false
			if (filters?.fromDate && row.createdAt < new Date(filters.fromDate)) return false
			if (filters?.toDate && row.createdAt > new Date(filters.toDate)) return false
			return true
		})
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async searchAuditActors(filters?: {
		corporationId?: string
		q?: string
		ids?: string[]
		limit?: number
	}) {
		const rows = ensureDemoState()
			.auditLog.filter(
				(row) => !filters?.corporationId || row.corporationId === filters.corporationId
			)
			.map((row) => ({
				userId: row.actorUserId,
				name: row.actorUserId === 'demo-admin' ? 'Demo Admin' : row.actorUserId,
			}))
		const deduped = Array.from(new Map(rows.map((row) => [row.userId, row])).values())
		const q = filters?.q?.trim().toLowerCase()
		const idSet = new Set((filters?.ids ?? []).map((id) => id.trim()).filter(Boolean))
		const filtered = deduped.filter((row) => {
			if (idSet.size > 0 && !idSet.has(row.userId)) {
				return false
			}
			if (!q) {
				return true
			}
			return row.userId.toLowerCase().includes(q) || (row.name ?? '').toLowerCase().includes(q)
		})
		return withLatency(filtered.slice(0, Math.max(1, Math.min(filters?.limit ?? 25, 100))))
	},
	async listNotificationDestinations(filters?: { limit?: number; offset?: number }) {
		const rows = ensureDemoState().notificationDestinations
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async upsertNotificationDestination(
		input: Partial<TaxNotificationDestination> & {
			name: string
			guildId: string
			channelId: string
		}
	) {
		const state = ensureDemoState()
		const existing = state.notificationDestinations[0]
		if (existing) {
			Object.assign(existing, input, { updatedAt: new Date() })
			return withLatency(existing)
		}
		const created = {
			id: `destination-${Date.now()}`,
			name: input.name,
			guildId: input.guildId,
			channelId: input.channelId,
			createdByUserId: 'demo-admin',
			updatedByUserId: 'demo-admin',
			createdAt: new Date(),
			updatedAt: new Date(),
		} as TaxNotificationDestination
		state.notificationDestinations.unshift(created)
		return withLatency(created)
	},
}

function notifyToggle(queryClient?: QueryClient): void {
	void queryClient?.invalidateQueries({ queryKey: ['corporation-tax'] })
	void queryClient?.invalidateQueries({ queryKey: ['entities'] })
}

export function installTaxDemoWindow(queryClient: QueryClient): void {
	if (!isDevRuntime()) return
	const target = window as typeof window & {
		__taxDemo?: {
			enable: (options?: { regenerate?: boolean; config?: Partial<DemoTaxConfig> }) => void
			disable: () => void
			toggle: () => boolean
			status: () => { enabled: boolean; seed: number | null; config: DemoTaxConfig }
			regenerate: (config?: Partial<DemoTaxConfig>) => void
			configure: (config: Partial<DemoTaxConfig>) => DemoTaxConfig
		}
	}
	target.__taxDemo = {
		enable: (options) => {
			persistEnabled(true)
			if (options?.config) updateDemoConfig(options.config)
			if (options?.regenerate || !demoState) regenerateDemoState()
			notifyToggle(queryClient)
		},
		disable: () => {
			persistEnabled(false)
			notifyToggle(queryClient)
		},
		toggle: () => {
			const next = !readEnabled()
			persistEnabled(next)
			if (next && !demoState) regenerateDemoState()
			notifyToggle(queryClient)
			return next
		},
		status: () => ({
			enabled: readEnabled(),
			seed: demoState?.seed ?? (readEnabled() ? readStoredSeed() : null),
			config: readStoredConfig(),
		}),
		regenerate: (config) => {
			if (config) updateDemoConfig(config)
			regenerateDemoState()
			notifyToggle(queryClient)
		},
		configure: (config) => {
			const next = updateDemoConfig(config)
			regenerateDemoState()
			notifyToggle(queryClient)
			return next
		},
	}
}
