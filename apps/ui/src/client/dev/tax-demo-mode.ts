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
	TaxBillStatus,
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
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
	UpdateTaxCorporationBillingConfigInput,
} from '@repo/corporation-tax'

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

type TaxReportFilters = {
	corporationId?: string
	fromDate?: string
	toDate?: string
	division?: number
	refType?: string
	refTypes?: string[]
	firstPartyId?: string
	secondPartyId?: string
	minAmount?: string
	maxAmount?: string
	limit?: number
	offset?: number
	sortBy?: string
	sortDir?: 'asc' | 'desc'
}

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

function mulberry32(seed: number) {
	return function rng() {
		let t = (seed += 0x6d2b79f5)
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function withLatency<T>(value: T): Promise<T> {
	return new Promise((resolve) => window.setTimeout(() => resolve(value), 120))
}

function toIsoDate(date: Date): string {
	return date.toISOString()
}

function toDateOnly(date: Date): string {
	return date.toISOString().slice(0, 10)
}

function startOfMonth(date = new Date()): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addDays(date: Date, days: number): Date {
	const copy = new Date(date)
	copy.setUTCDate(copy.getUTCDate() + days)
	return copy
}

function addMonths(date: Date, months: number): Date {
	const copy = new Date(date)
	copy.setUTCMonth(copy.getUTCMonth() + months)
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

function maybeFilterReportRows<T extends { corporationId?: string | null }>(
	rows: T[],
	filters?: TaxReportFilters
): T[] {
	return rows.filter((row) => {
		if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
		return true
	})
}

function buildDemoState(seed: number) {
	const rng = mulberry32(seed)
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
		name: `${corpNamePrefixes[index % corpNamePrefixes.length]} ${corpNameSuffixes[index % corpNameSuffixes.length]}`,
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

	const totalTaxes = corporations.map((corp, index) => {
		const due = 2_400_000_000 + index * 650_000_000 + Math.round(rng() * 220_000_000)
		const paid =
			due - (index % 6 === 2 ? 540_000_000 : 95_000_000 + Math.round(rng() * 120_000_000))
		return {
			corporationId: corp.corporationId,
			assessmentCount: 18 + (index % 6) * 4,
			billedAssessmentCount: 14 + (index % 5) * 3,
			underpaidCount: index % 6 === 2 ? 4 : 1,
			paidCount: 11 + (index % 8),
			overpaidCount: index % 5 === 1 ? 1 : 0,
			draftCount: index % 8 === 0 ? 1 : 0,
			excludedCount: index % 9 === 3 ? 2 : 0,
			taxableIncome: amount(due * 10.8),
			taxDue: amount(due),
			taxPaid: amount(Math.max(0, paid)),
			taxDelta: amount(due - Math.max(0, paid)),
			lastAssessmentAt: addDays(demoStart, Math.max(0, demoDaySpan - 8 + (index % 6))),
		}
	}) as TaxTotalTaxesByCorporationRow[]

	const topIncome = [
		{
			refType: 'bounty_prizes',
			entryCount: 124 * Math.max(1, Math.ceil(config.corporationCount / 4)),
			essEntryCount: 0,
			totalIncome: amount(18_400_000_000 * Math.max(1, Math.ceil(config.corporationCount / 4))),
		},
		{
			refType: 'ess_escrow_transfer',
			entryCount: 18 * Math.max(1, Math.ceil(config.corporationCount / 5)),
			essEntryCount: 18 * Math.max(1, Math.ceil(config.corporationCount / 5)),
			totalIncome: amount(7_200_000_000 * Math.max(1, Math.ceil(config.corporationCount / 5))),
		},
		{
			refType: 'market_transaction',
			entryCount: 42 * Math.max(1, Math.ceil(config.corporationCount / 4)),
			essEntryCount: 0,
			totalIncome: amount(3_850_000_000 * Math.max(1, Math.ceil(config.corporationCount / 4))),
		},
		{
			refType: 'player_donation',
			entryCount: 7 * Math.max(1, Math.ceil(config.corporationCount / 6)),
			essEntryCount: 0,
			totalIncome: amount(620_000_000 * Math.max(1, Math.ceil(config.corporationCount / 6))),
		},
	] as TaxTopIncomeSourceRow[]

	const essRows = Array.from({
		length: Math.max(config.corporationCount * config.months * 3, 24),
	}).map((_, index) => {
		const corporation = corporations[index % corporations.length]!
		const divisionList = walletDivisions[corporation.corporationId]!
		return {
			id: `ess-${index}`,
			corporationId: corporation.corporationId,
			entryDate: addDays(demoStart, index % demoDaySpan),
			division: divisionList[index % divisionList.length] ?? 1,
			essBankType: index % 2 === 0 ? 'main' : 'reserve',
			amount: amount(1_850_000_000 + index * 420_000_000),
			sourceType: 'corporation_wallet_journal',
			sourcePrimaryId: `journal-${index}`,
			firstPartyId: '80000002',
			secondPartyId: '80000001',
		}
	}) as TaxEssPayoutRow[]

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

	const compliance = Array.from({ length: config.months }).map((_, index) => {
		const monthStartForPoint = addMonths(demoStart, index)
		const monthEnd = new Date(
			Date.UTC(monthStartForPoint.getUTCFullYear(), monthStartForPoint.getUTCMonth() + 1, 0)
		)
		const due = 12_500_000_000 + index * 2_200_000_000
		const paid = Math.max(
			0,
			due -
				(index % 4 === 2
					? 1_300_000_000 + Math.round(rng() * 300_000_000)
					: 350_000_000 + Math.round(rng() * 220_000_000))
		)
		return {
			rollupDate: monthEnd,
			taxDue: amount(due),
			taxPaid: amount(paid),
			taxDelta: amount(due - paid),
			entryCount: 22 + (index % 6),
		}
	}) as TaxCompliancePoint[]

	const billStatus = corporations.map((corp, index) => ({
		corporationId: corp.corporationId,
		billStatus: (index === 2 ? 'overdue' : index === 1 ? 'paid' : 'issued') as TaxBillStatus,
		assessmentCount: 4 + index,
		taxDue: amount(1_350_000_000 + index * 420_000_000),
		taxPaid: amount(index === 2 ? 610_000_000 : 1_180_000_000 + index * 340_000_000),
		taxDelta: amount(index === 2 ? 740_000_000 : 170_000_000 + index * 80_000_000),
	})) as TaxBillStatusReportRow[]

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
			isEss: refType === 'ess_escrow_transfer',
			essBankType:
				refType === 'ess_escrow_transfer' ? (index % 2 === 0 ? 'main' : 'reserve') : null,
			rawPayload: JSON.stringify({ refType, sourceType }),
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
			status: (billId ? 'underpaid' : 'paid') as TaxAssessment['status'],
			taxDue: amount(due),
			taxPaid: amount(Math.max(0, paid)),
			taxDelta: amount(due - Math.max(0, paid)),
			taxPeriodEnd: addDays(demoStart, Math.min(index % demoDaySpan, demoDaySpan - 1)),
			taxPeriodStart: addDays(demoStart, Math.max(0, (index % demoDaySpan) - 29)),
			billId,
			billStatus: (billId ? 'issued' : null) as TaxAssessment['billStatus'],
			createdAt: addDays(demoStart, index % demoDaySpan),
			updatedAt: addDays(demoStart, Math.min((index % demoDaySpan) + 2, demoDaySpan - 1)),
		}
	}) as TaxAssessment[]

	const billHistory = assessments
		.filter((assessment) => assessment.billId)
		.slice(0, 8)
		.map((assessment, index) => ({
			assessment,
			timeline: [
				{ createdAt: addDays(monthStart, 5 + index) },
				{ createdAt: addDays(monthStart, 10 + index) },
			],
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
			scope: 'corporation',
			corporationId: '99010001',
			guildId: '111111',
			channelId: '222222',
			isActive: true,
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
			effectiveFrom: addDays(startOfMonth(), -30),
			effectiveTo: null,
			appliesToRefType: null,
			partyType: null,
			taxRateBps: 500,
			label: 'Base rate',
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
			effectiveFrom: addDays(startOfMonth(), -10),
			effectiveTo: null,
			appliesToRefType: 'ess_escrow_transfer',
			partyType: null,
			taxRateBps: 950,
			label: 'ESS rate',
			createdBy: 'demo-admin',
			createdAt: addDays(startOfMonth(), -10),
			updatedAt: addDays(startOfMonth(), -2),
		},
	] as TaxRuleSet[]

	const billingConfigs = corporations.map((corp, index) => {
		const payeeType: '' | 'character' | 'corporation' =
			index % 3 === 0 ? 'character' : 'corporation'
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
		totalTaxes,
		topIncome,
		essRows,
		discrepancies,
		compliance,
		billStatus,
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
		if (filters?.division !== undefined && row.division !== filters.division) return false
		if (filters?.refType && row.refType !== filters.refType) return false
		if (filters?.firstPartyId && row.firstPartyId !== filters.firstPartyId) return false
		if (filters?.secondPartyId && row.secondPartyId !== filters.secondPartyId) return false
		if (filters?.minAmount && parseAmount(row.amount) < parseAmount(filters.minAmount)) return false
		if (filters?.maxAmount && parseAmount(row.amount) > parseAmount(filters.maxAmount)) return false
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

function buildSummary(rows: TaxTotalTaxesByCorporationRow[]): TaxSummaryReport {
	const taxDue = rows.reduce((sum, row) => sum + parseAmount(row.taxDue), 0)
	const taxPaid = rows.reduce((sum, row) => sum + parseAmount(row.taxPaid), 0)
	const assessments = rows.reduce((sum, row) => sum + row.assessmentCount, 0)
	return {
		corporationId: rows.length === 1 ? rows[0]!.corporationId : null,
		fromDate: startOfMonth(),
		toDate: addDays(startOfMonth(), 29),
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
			label: string
		}
	) {
		const state = ensureDemoState()
		const created = {
			id: `rule-${Date.now()}`,
			ruleGroupId: input.ruleGroupId,
			name: input.name,
			priority: input.priority ?? 0,
			isActive: input.isActive ?? true,
			effectiveFrom: new Date(),
			effectiveTo: null,
			appliesToRefType: input.appliesToRefType ?? null,
			partyType: null,
			taxRateBps: input.taxRateBps,
			label: input.label,
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
			partyType?: string | null
			taxRateBps?: number
			label?: string
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
				effectiveFrom: new Date(),
				effectiveTo: null,
				appliesToRefType: input.appliesToRefType ?? null,
				partyType: input.partyType ?? null,
				taxRateBps: input.taxRateBps ?? 750,
				label: input.label ?? 'Demo rule',
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
		if (input.partyType !== undefined) {
			existing.partyType = input.partyType
		}
		existing.taxRateBps = input.taxRateBps ?? existing.taxRateBps
		existing.label = input.label ?? existing.label
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
			billingPayeeType: input.billingPayeeType ?? '',
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
		const assessment = ensureDemoState().assessments.find(
			(row) => row.id === assessmentId && row.corporationId === corporationId
		)
		if (assessment) {
			assessment.billId = assessment.billId ?? `bill-${assessmentId}`
			assessment.billStatus = 'issued' as any
		}
		return withLatency(assessment ?? ensureDemoState().assessments[0]!)
	},
	async syncAssessmentBillStatus(corporationId: string, assessmentId: string) {
		const assessment = ensureDemoState().assessments.find(
			(row) => row.id === assessmentId && row.corporationId === corporationId
		)
		if (assessment?.billId) {
			assessment.billStatus = 'paid' as any
			assessment.taxPaid = assessment.taxDue
			assessment.taxDelta = amount(0)
			assessment.status = 'paid' as any
		}
		return withLatency(assessment ?? ensureDemoState().assessments[0]!)
	},
	async retractAssessmentBill(corporationId: string, assessmentId: string) {
		const assessment = ensureDemoState().assessments.find(
			(row) => row.id === assessmentId && row.corporationId === corporationId
		)
		if (assessment?.billId) {
			assessment.billStatus = 'cancelled' as any
		}
		return withLatency(assessment ?? ensureDemoState().assessments[0]!)
	},
	async issueBillsForPeriod(corporationId: string): Promise<IssueBillsForPeriodResult> {
		const issued = ensureDemoState()
			.assessments.filter((row) => row.corporationId === corporationId && !row.billId)
			.map((row) => {
				row.billId = `bill-${row.id}`
				row.billStatus = 'issued' as any
				return row.id
			})
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
		const rows = ensureDemoState().assessments.filter((row) => row.corporationId === corporationId)
		const updated = rows
			.filter((row) => row.billId)
			.slice(0, 2)
			.map((row) => {
				row.billStatus = 'paid' as any
				row.taxPaid = row.taxDue
				row.taxDelta = amount(0)
				return row.id
			})
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
	async getBillStatusReport(filters?: TaxReportFilters) {
		const rows = sortRows(
			maybeFilterReportRows(ensureDemoState().billStatus, filters),
			filters?.sortBy,
			filters?.sortDir
		)
		return withLatency(rows)
	},
	async getCorporationBillHistory(
		corporationId: string,
		filters?: { limit?: number; offset?: number }
	) {
		return withLatency(
			applyLimitOffset(
				ensureDemoState().billHistory.filter(
					(row) => row.assessment.corporationId === corporationId
				),
				filters?.limit,
				filters?.offset
			)
		)
	},
	async getSummaryReport(filters?: TaxReportFilters) {
		const rows = maybeFilterReportRows(ensureDemoState().totalTaxes, filters)
		return withLatency(buildSummary(rows))
	},
	async getTotalTaxesReport(filters?: TaxReportFilters) {
		let rows = maybeFilterReportRows(ensureDemoState().totalTaxes, filters)
		rows = sortRows(rows, filters?.sortBy, filters?.sortDir)
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getTopIncomeSourcesReport(filters?: TaxReportFilters) {
		let rows = ensureDemoState().topIncome
		if (filters?.refType) rows = rows.filter((row) => row.refType === filters.refType)
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
			current.essEntryCount += row.isEss ? 1 : 0
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
		let rows = filterLedgerEntries(
			ensureDemoState().essRows as any,
			filters
		) as any as TaxEssPayoutRow[]
		rows = sortRows(rows as any, filters?.sortBy, filters?.sortDir) as TaxEssPayoutRow[]
		return withLatency({
			rows: applyLimitOffset(rows, filters?.limit, filters?.offset),
			totalRows: rows.length,
		})
	},
	async getComplianceReport(filters?: TaxReportFilters) {
		const rows = ensureDemoState().compliance.filter((row) =>
			matchesDate(row.rollupDate, filters?.fromDate, filters?.toDate)
		)
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
		filters?: { characterQuery?: string; limit?: number }
	) {
		const query = filters?.characterQuery?.trim()
		const rows = ensureDemoState().memberSummary.filter((row) => {
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
		return withLatency(filters?.limit ? rows.slice(0, filters.limit) : rows)
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
		limit?: number
		offset?: number
	}) {
		const rows = ensureDemoState().auditLog.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			if (filters?.actorUserId && row.actorUserId !== filters.actorUserId) return false
			if (filters?.action && row.action !== filters.action) return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async listNotificationDestinations(filters?: {
		corporationId?: string
		limit?: number
		offset?: number
	}) {
		const rows = ensureDemoState().notificationDestinations.filter((row) => {
			if (filters?.corporationId && row.corporationId !== filters.corporationId) return false
			return true
		})
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async upsertNotificationDestination(
		input: Partial<TaxNotificationDestination> & {
			corporationId?: string
			guildId: string
			channelId: string
			scope: 'global' | 'corporation'
		}
	) {
		const state = ensureDemoState()
		const existing = state.notificationDestinations.find(
			(row) => row.corporationId === (input.corporationId ?? null) && row.scope === input.scope
		)
		if (existing) {
			Object.assign(existing, input, { updatedAt: new Date() })
			return withLatency(existing)
		}
		const created = {
			id: `destination-${Date.now()}`,
			scope: input.scope,
			corporationId: input.corporationId ?? null,
			guildId: input.guildId,
			channelId: input.channelId,
			isActive: input.isActive ?? true,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as TaxNotificationDestination
		state.notificationDestinations.unshift(created)
		return withLatency(created)
	},
}

function notifyToggle(queryClient?: QueryClient): void {
	queryClient?.invalidateQueries({ queryKey: ['corporation-tax'] })
	queryClient?.invalidateQueries({ queryKey: ['entities'] })
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
