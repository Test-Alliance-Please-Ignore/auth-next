import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { MemberSummaryGridCard } from '@/components/tax-member-summary/member-summary-grid-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { useCorporationAccess } from '@/features/corporations'
import {
	useTaxableIncomeRefTypes,
	useTaxCapabilities,
	useTaxCorporations,
	useTaxSummaryReport,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getCurrentMonthDateRange, shiftMonthRange } from '@/lib/tax-date'
import { formatTaxIskCompact, formatTaxNumber, TAX_REF_TYPE_OPTIONS } from '@/lib/tax-display'

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()

export default function TaxMemberSummaryPage() {
	usePageTitle('Tax Member Summary')

	const { data: globalCapabilities, isLoading: globalCapabilitiesLoading } = useTaxCapabilities()
	const canReadWithUrn = globalCapabilities?.global.canRead ?? false
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()

	const { data: corporationSettings = [], isLoading: corporationSettingsLoading } =
		useTaxCorporations({
			limit: 1000,
			enabled: canReadWithUrn,
		})
	const isCorporationScopeLoading =
		globalCapabilitiesLoading || corporationAccessLoading || corporationSettingsLoading

	const unresolvedCorporationIds = useMemo(() => {
		if (isCorporationScopeLoading) {
			return []
		}
		const accessIdSet = new Set(
			(corporationAccess?.corporations ?? []).map((corp) => corp.corporationId)
		)
		return corporationSettings
			.map((setting) => setting.corporationId)
			.filter((corporationId) => !accessIdSet.has(corporationId))
	}, [isCorporationScopeLoading, corporationAccess?.corporations, corporationSettings])
	const { data: resolvedCorporationNames = {} } = useEntityNames(unresolvedCorporationIds, {
		enabled: !isCorporationScopeLoading && unresolvedCorporationIds.length > 0,
	})

	const corporationOptions = useMemo(() => {
		if (isCorporationScopeLoading) {
			return []
		}
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) {
			map.set(corp.corporationId, corp.name)
		}
		for (const setting of corporationSettings) {
			if (!map.has(setting.corporationId)) {
				map.set(
					setting.corporationId,
					resolvedCorporationNames[setting.corporationId] ?? setting.corporationId
				)
			}
		}
		return Array.from(map.entries()).map(([corporationId, name]) => ({ corporationId, name }))
	}, [
		isCorporationScopeLoading,
		corporationAccess?.corporations,
		corporationSettings,
		resolvedCorporationNames,
	])

	const [selectedCorporationId, setSelectedCorporationId] = useState<string | undefined>(undefined)
	const [characterQuery, setCharacterQuery] = useState('')
	const [incomeTypes, setIncomeTypes] = useState<string[]>([])
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [refreshToken, setRefreshToken] = useState(0)
	const [memberStats, setMemberStats] = useState({
		membersInView: 0,
		totalIncome: 0,
		totalTaxableIncome: 0,
	})
	const handleStatsChange = useCallback(
		(next: { membersInView: number; totalIncome: number; totalTaxableIncome: number }) => {
			setMemberStats((current) =>
				current.membersInView === next.membersInView &&
				current.totalIncome === next.totalIncome &&
				current.totalTaxableIncome === next.totalTaxableIncome
					? current
					: next
			)
		},
		[]
	)

	const effectiveCorporationId = useMemo(() => {
		if (isCorporationScopeLoading) {
			return undefined
		}
		if (selectedCorporationId) {
			return selectedCorporationId
		}
		if (corporationOptions.length > 0) {
			return corporationOptions[0]?.corporationId
		}
		return undefined
	}, [isCorporationScopeLoading, selectedCorporationId, corporationOptions])

	const { data: scopedCapabilities } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewSummaryTotals =
		(globalCapabilities?.global.canAudit ?? false) || (scopedCapabilities?.scoped.canAudit ?? false)
	const canViewMemberSummary =
		canReadWithUrn ||
		(scopedCapabilities?.scoped.canRead ?? false) ||
		(corporationAccess?.hasAccess ?? false)
	const canSearchCharacter =
		canReadWithUrn ||
		(scopedCapabilities?.scoped.canRead ?? false) ||
		(corporationAccess?.hasAccess ?? false)
	const { data: taxableIncomeTypes = [] } = useTaxableIncomeRefTypes(
		effectiveCorporationId,
		canViewMemberSummary
	)
	const hasActiveFilters =
		characterQuery.trim().length > 0 ||
		incomeTypes.length > 0 ||
		fromDate !== DEFAULT_MONTH_RANGE.fromDate ||
		toDate !== DEFAULT_MONTH_RANGE.toDate
	const clearFilters = () => {
		setCharacterQuery('')
		setIncomeTypes([])
		setFromDate(DEFAULT_MONTH_RANGE.fromDate)
		setToDate(DEFAULT_MONTH_RANGE.toDate)
	}
	const moveMonth = (monthOffset: number) => {
		const nextRange = shiftMonthRange(fromDate, monthOffset)
		setFromDate(nextRange.fromDate)
		setToDate(nextRange.toDate)
	}

	const fromDateIso = fromDate ? new Date(`${fromDate}T00:00:00.000Z`).toISOString() : undefined
	const toDateIso = toDate ? new Date(`${toDate}T23:59:59.999Z`).toISOString() : undefined

	const {
		data: summaryReport,
		isFetching: isSummaryReportFetching,
		refetch: refetchSummaryReport,
	} = useTaxSummaryReport({
		corporationId: effectiveCorporationId,
		fromDate: fromDateIso,
		toDate: toDateIso,
		enabled: Boolean(effectiveCorporationId) && !isCorporationScopeLoading && canViewSummaryTotals,
	})

	const isRefreshing = isSummaryReportFetching

	return (
		<Container>
			<PageHeader
				title="Tax Member Summary"
				description="View member-attributed contribution into corporation wallet inflows and taxable contribution by source."
			/>

			<Section>
				{isCorporationScopeLoading ? (
					<Card>
						<CardHeader>
							<CardTitle>Loading Corporation Scope</CardTitle>
							<CardDescription>
								Resolving accessible corporations before loading member summaries.
							</CardDescription>
						</CardHeader>
					</Card>
				) : corporationOptions.length > 0 ? (
					<TaxCorporationScopeSelector
						corporations={corporationOptions}
						effectiveCorporationId={effectiveCorporationId}
						onSelect={setSelectedCorporationId}
					/>
				) : (
					<Card>
						<CardHeader>
							<CardTitle>No Corporation Scope</CardTitle>
							<CardDescription>No corporation scope is available for this account.</CardDescription>
						</CardHeader>
					</Card>
				)}

				<Card>
					<CardHeader>
						<CardTitle>Filters</CardTitle>
						<CardDescription>
							Filter by period and optionally search members by character name prefix or exact ID.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2">
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
							<div className="space-y-2">
								<div className="text-sm font-medium">Date Range</div>
								<div className="flex items-center gap-1">
									<Button
										type="button"
										variant="ghost"
										size="icon"
										showIcon={false}
										className="h-10 w-10 shrink-0 p-0"
										aria-label="Previous month"
										onClick={() => moveMonth(-1)}
									>
										<ChevronLeft className="h-4 w-4" aria-hidden="true" />
									</Button>
									<DateRangeInput
										value={{ fromDate, toDate }}
										onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
											setFromDate(nextFromDate)
											setToDate(nextToDate)
										}}
										placeholder="Date range"
										className="min-w-0 flex-1 [&_.themed-date-picker__input]:h-10 [&_.themed-date-picker__input]:w-full"
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										showIcon={false}
										className="h-10 w-10 shrink-0 p-0"
										aria-label="Next month"
										onClick={() => moveMonth(1)}
									>
										<ChevronRight className="h-4 w-4" aria-hidden="true" />
									</Button>
								</div>
							</div>
							<div className="space-y-2">
								<div className="text-sm font-medium">Character</div>
								<div className="space-y-2 md:space-y-0">
									<Input
										value={characterQuery}
										onChange={(event) => setCharacterQuery(event.target.value)}
										placeholder="Character name or ID"
										disabled={!canSearchCharacter}
										className="h-10"
									/>
								</div>
							</div>
							<div className="space-y-2">
								<div className="text-sm font-medium">Income Types</div>
								<div className="flex items-center gap-2">
									<div className="min-w-0 flex-1">
										<Select
											options={TAX_REF_TYPE_OPTIONS}
											values={incomeTypes}
											onValuesChange={setIncomeTypes}
											multiple
											searchable
											placeholder="All income types"
											inputClassName="h-10"
											contentClassName="w-[min(20rem,calc(100vw-2rem))] min-w-[min(20rem,calc(100vw-2rem))]"
										/>
									</div>
									<Button
										type="button"
										variant="secondary"
										className="h-10 shrink-0"
										showIcon={false}
										disabled={taxableIncomeTypes.length === 0}
										onClick={() => setIncomeTypes(taxableIncomeTypes)}
									>
										Taxable only
									</Button>
								</div>
							</div>
							<div className="space-y-2">
								<div className="h-5" aria-hidden="true" />
								<div className="flex justify-end gap-2">
									<Button
										type="button"
										variant="ghost"
										className="h-10"
										onClick={clearFilters}
										disabled={!hasActiveFilters}
									>
										Clear Filters
									</Button>
									<Button
										type="button"
										onClick={() => {
											void refetchSummaryReport()
											setRefreshToken((value) => value + 1)
										}}
										disabled={isRefreshing}
										variant="primary"
										className="h-10 w-28"
									>
										{isRefreshing ? 'Refreshing…' : 'Refresh'}
									</Button>
								</div>
							</div>
						</div>
					</CardContent>
				</Card>

				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Members in View</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxNumber(memberStats.membersInView)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Total Income</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxIskCompact(memberStats.totalIncome)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Taxable Income Due</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatTaxIskCompact(memberStats.totalTaxableIncome)}
						</CardContent>
					</Card>
					{canViewSummaryTotals ? (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Taxes Paid</CardTitle>
							</CardHeader>
							<CardContent className="text-2xl font-semibold">
								{formatTaxIskCompact(summaryReport?.taxPaid ?? '0')}
							</CardContent>
						</Card>
					) : null}
				</div>

				<MemberSummaryGridCard
					effectiveCorporationId={effectiveCorporationId}
					isScopeLoading={isCorporationScopeLoading}
					canViewSummary={canViewMemberSummary}
					canSearchCharacter={canSearchCharacter}
					characterQuery={characterQuery}
					refTypes={incomeTypes}
					fromDateIso={fromDateIso}
					toDateIso={toDateIso}
					refreshToken={refreshToken}
					onStatsChange={handleStatsChange}
				/>
			</Section>
		</Container>
	)
}
