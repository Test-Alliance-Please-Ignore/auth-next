import type { QueryClient } from '@tanstack/react-query'
import type {
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
	TaxCorporationSettings,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExcludedCorporationRow,
	TaxExportArtifact,
	TaxExportFormat,
	TaxExportRecord,
	TaxExportSchedule,
	TaxExportStatus,
	TaxLedgerEntry,
	TaxMemberSummary,
	TaxMissingEsiKeyRow,
	TaxNotificationDestination,
	TaxRuleSet,
	TaxSummaryReport,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
} from '@repo/corporation-tax'

const ENABLED_STORAGE_KEY = 'auth-next.tax-demo.enabled'
const SEED_STORAGE_KEY = 'auth-next.tax-demo.seed'
const CONFIG_STORAGE_KEY = 'auth-next.tax-demo.config'

type DemoTaxConfig = {
	corporationCount: number
	months: number
}

const DEFAULT_DEMO_TAX_CONFIG: DemoTaxConfig = {
	corporationCount: 20,
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
		defaultRateBps: 750,
		essRateBps: 950,
		discrepancyThresholdBps: 500,
		memberSummaryEnabled: true,
		billingEnabled: true,
		billingIssuerUserId: 'demo-admin',
		billingPayeeId: '80000001',
		billingPayeeType: 'corporation',
		billingDueDays: 14,
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
	})) as TaxCorporationSettings[]

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

	const compliance = Array.from({ length: demoDaySpan }).map((_, index) => ({
		rollupDate: addDays(demoStart, index),
		taxDue: amount(3_250_000_000 + index * 520_000_000),
		taxPaid: amount(2_840_000_000 + index * 451_000_000),
		taxDelta: amount(410_000_000 + index * 69_000_000),
		entryCount: 18 + (index % 12),
	})) as TaxCompliancePoint[]

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
			const taxDue = 860_000_000 + index * 175_000_000
			const taxPaid = index % 3 === 0 ? taxDue - 92_000_000 : taxDue
			return {
				corporationId: corporation.corporationId,
				characterId,
				complianceStatus: (index % 3 === 0
					? 'underpaid'
					: 'paid') as TaxMemberSummary['complianceStatus'],
				assessmentCount: 2 + index,
				taxDue: amount(taxDue),
				taxPaid: amount(taxPaid),
				taxDelta: amount(taxDue - taxPaid),
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
			action: 'tax.settings.updated',
			before: { defaultRateBps: 700 },
			after: { defaultRateBps: 750 },
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
			included: setting.included,
			isConfigured: setting.esiAuthStatus?.isConfigured ?? false,
			hasRequiredScopes: setting.esiAuthStatus?.hasRequiredScopes ?? false,
			hasCorporationWalletScope: setting.esiAuthStatus?.hasCorporationWalletScope ?? false,
			missingRequiredScopes: setting.esiAuthStatus?.missingRequiredScopes ?? [],
			healthyDirectorCount: setting.esiAuthStatus?.healthyDirectorCount ?? 0,
			directorCount: setting.esiAuthStatus?.directorCount ?? 0,
			lastVerified: setting.esiAuthStatus?.lastVerified ?? null,
		})) as TaxMissingEsiKeyRow[]

	const excluded = settings
		.filter((setting) => !setting.included)
		.map((setting) => ({
			corporationId: setting.corporationId,
			exclusionReason: setting.exclusionReason,
			updatedAt: setting.updatedAt,
		})) as TaxExcludedCorporationRow[]

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
		excluded,
		exports,
		schedules,
		notificationDestinations,
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
		return a > b ? direction : -direction
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
	async listCorporations(filters?: { included?: boolean; limit?: number; offset?: number }) {
		const rows = ensureDemoState().settings.filter((row) =>
			filters?.included === undefined ? true : row.included === filters.included
		)
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getCorporationSettings(corporationId: string) {
		return withLatency(
			ensureDemoState().settings.find((row) => row.corporationId === corporationId) ??
				ensureDemoState().settings[0]!
		)
	},
	async listWalletDivisions(corporationId: string) {
		return withLatency(ensureDemoState().walletDivisions[corporationId] ?? [])
	},
	async updateTaxCorporationSettings(
		corporationId: string,
		input: Partial<TaxCorporationSettings>
	) {
		const state = ensureDemoState()
		const current = state.settings.find((row) => row.corporationId === corporationId)
		if (current) Object.assign(current, input, { updatedAt: new Date() })
		return withLatency(current ?? state.settings[0]!)
	},
	async listRuleSets(corporationId: string) {
		const settings = ensureDemoState().settings
		const base = [
			{
				id: 'rule-1',
				corporationId: null,
				name: 'Default Alliance Tax',
				priority: 100,
				isActive: true,
				effectiveFrom: addDays(startOfMonth(), -30),
				effectiveTo: null,
				createdBy: 'demo-admin',
				createdAt: addDays(startOfMonth(), -20),
				updatedAt: addDays(startOfMonth(), -5),
				conditions: [],
				actions: [
					{
						id: 'action-1',
						ruleSetId: 'rule-1',
						taxRateBps: 750,
						isTaxable: true,
						label: 'Base rate',
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			},
			{
				id: 'rule-2',
				corporationId,
				name: `ESS Override ${settings.find((row) => row.corporationId === corporationId)?.corporationId ?? corporationId}`,
				priority: 50,
				isActive: true,
				effectiveFrom: addDays(startOfMonth(), -10),
				effectiveTo: null,
				createdBy: 'demo-admin',
				createdAt: addDays(startOfMonth(), -10),
				updatedAt: addDays(startOfMonth(), -2),
				conditions: [
					{
						id: 'cond-1',
						ruleSetId: 'rule-2',
						appliesToRefType: 'ess_escrow_transfer',
						walletDivision: null,
						partyType: null,
						minAmount: null,
						maxAmount: null,
						isEssOnly: true,
						essBankType: 'main',
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
				actions: [
					{
						id: 'action-2',
						ruleSetId: 'rule-2',
						taxRateBps: 950,
						isTaxable: true,
						label: 'ESS rate',
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			},
		] as TaxRuleSet[]
		return withLatency(base)
	},
	async createRuleSet(corporationId: string | undefined, input: { name: string }) {
		const created = {
			id: `rule-${Date.now()}`,
			corporationId: corporationId ?? null,
			name: input.name,
			priority: 100,
			isActive: true,
			effectiveFrom: new Date(),
			effectiveTo: null,
			createdBy: 'demo-admin',
			createdAt: new Date(),
			updatedAt: new Date(),
			conditions: [],
			actions: [],
		} as TaxRuleSet
		return withLatency(created)
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
		const rows = maybeFilterReportRows(ensureDemoState().billStatus, filters)
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
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getTopIncomeSourcesReport(filters?: TaxReportFilters) {
		let rows = ensureDemoState().topIncome
		if (filters?.refType) rows = rows.filter((row) => row.refType === filters.refType)
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getEssPayoutReport(filters?: TaxReportFilters) {
		let rows = filterLedgerEntries(
			ensureDemoState().essRows as any,
			filters
		) as any as TaxEssPayoutRow[]
		rows = sortRows(rows as any, filters?.sortBy, filters?.sortDir) as TaxEssPayoutRow[]
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
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
		return withLatency(applyLimitOffset(rows, filters?.limit, filters?.offset))
	},
	async getMissingEsiKeysReport() {
		return withLatency(ensureDemoState().missingEsi)
	},
	async getExcludedCorporationsReport() {
		return withLatency(ensureDemoState().excluded)
	},
	async getMemberSummary(
		corporationId: string,
		filters?: { characterId?: string; limit?: number }
	) {
		const rows = ensureDemoState().memberSummary.filter((row) => {
			if (row.corporationId !== corporationId) return false
			if (filters?.characterId && row.characterId !== filters.characterId) return false
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
