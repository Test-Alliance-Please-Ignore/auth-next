import { useCallback, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { MemberSummaryGridCard } from '@/components/tax-member-summary/member-summary-grid-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useCorporationAccess } from '@/features/corporations'
import {
	useTaxCapabilities,
	useTaxCorporations,
	useTaxSummaryReport,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { getCurrentMonthDateRange } from '@/lib/tax-date'
import { formatTaxIskCompact, formatTaxNumber } from '@/lib/tax-display'

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()
export default function TaxMemberSummaryPage() {
	usePageTitle('Tax Member Summary')

	const { data: globalCapabilities, isLoading: globalCapabilitiesLoading } = useTaxCapabilities()
	const canReadWithUrn = globalCapabilities?.global.canRead ?? false
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()

	const { data: corporationSettings = [], isLoading: corporationSettingsLoading } = useTaxCorporations({
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
	}, [isCorporationScopeLoading, corporationAccess?.corporations, corporationSettings, resolvedCorporationNames])

	const [selectedCorporationId, setSelectedCorporationId] = useState<string | undefined>(undefined)
	const [characterQuery, setCharacterQuery] = useState('')
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
						<div className="hidden md:grid md:grid-cols-2 md:gap-3">
							<div className="text-sm font-medium">Date Range</div>
							<div className="grid grid-cols-[1fr_auto] gap-3">
								<div className="text-sm font-medium">Character</div>
								<div />
							</div>
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							<div className="space-y-2 md:space-y-0">
								<div className="text-sm font-medium md:hidden">Date Range</div>
								<DateRangeInput
									value={{ fromDate, toDate }}
									onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
										setFromDate(nextFromDate)
										setToDate(nextToDate)
									}}
									placeholder="Date range"
									className="[&_.themed-date-picker__input]:h-10"
								/>
							</div>
							<div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
								<div className="space-y-2 md:space-y-0">
									<div className="text-sm font-medium md:hidden">Character</div>
									<Input
										value={characterQuery}
										onChange={(event) => setCharacterQuery(event.target.value)}
										placeholder="Character name or ID"
										disabled={!canSearchCharacter}
										className="h-10"
									/>
								</div>
								<Button
									type="button"
									onClick={() => {
										void refetchSummaryReport()
										setRefreshToken((value) => value + 1)
									}}
									disabled={isRefreshing}
									variant="ghost"
									className="h-10"
								>
									{isRefreshing ? 'Refreshing…' : 'Refresh'}
								</Button>
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
					fromDateIso={fromDateIso}
					toDateIso={toDateIso}
					refreshToken={refreshToken}
					onStatsChange={handleStatsChange}
				/>
			</Section>
		</Container>
	)
}
