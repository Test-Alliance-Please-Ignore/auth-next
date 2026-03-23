import { useEffect, useMemo } from 'react'

import { MemberSummaryReportGrid } from '@/components/tax-reports/grids'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTaxMemberSummary } from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'

type MemberSummaryStats = {
	membersInView: number
	totalIncome: number
	totalTaxableIncome: number
}

type MemberSummaryGridCardProps = {
	effectiveCorporationId?: string
	canSearchCharacter: boolean
	characterQuery: string
	fromDateIso?: string
	toDateIso?: string
	refreshToken: number
	onStatsChange?: (stats: MemberSummaryStats) => void
}

const UNATTRIBUTED_CHARACTER_ID = '__unattributed__'

function parseIsk(value: string): number {
	const normalized = value.trim().replace(/,/g, '')
	const parsed = Number(normalized)
	return Number.isFinite(parsed) ? parsed : 0
}

export function MemberSummaryGridCard(props: MemberSummaryGridCardProps) {
	const grid = useReportGridState({
		defaultSortBy: 'contributionIncome',
		defaultSortDir: 'desc',
		defaultPageSize: 25,
		resetOn: {
			effectiveCorporationId: props.effectiveCorporationId,
			fromDateIso: props.fromDateIso,
			toDateIso: props.toDateIso,
			characterQuery: props.characterQuery,
		},
	})

	const { data, isLoading, isFetching, error, refetch } = useTaxMemberSummary(
		props.effectiveCorporationId,
		{
			characterQuery: props.canSearchCharacter
				? props.characterQuery.trim() || undefined
				: undefined,
			fromDate: props.fromDateIso,
			toDate: props.toDateIso,
			limit: grid.limit,
			offset: grid.offset,
			sortBy:
				(grid.sortBy as
					| 'characterId'
					| 'contributionIncome'
					| 'taxableContributionIncome'
					| 'assessmentCount'
					| 'lastAssessmentAt') ?? 'contributionIncome',
			sortDir: grid.sortDir,
			enabled: Boolean(props.effectiveCorporationId),
		}
	)

	useEffect(() => {
		void refetch()
	}, [props.refreshToken, refetch])

	const rows = useMemo(() => data?.rows ?? [], [data?.rows])
	const totalRows = data?.totalRows ?? 0
	const pageCount = grid.pageCountFor(totalRows)

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of rows) {
			ids.add(row.corporationId)
			if (row.characterId !== UNATTRIBUTED_CHARACTER_ID) {
				ids.add(row.characterId)
			}
		}
		return [...ids]
	}, [rows])

	const { data: entityNames = {} } = useEntityNames(entityIds, {
		enabled: Boolean(props.effectiveCorporationId),
	})

	useEffect(() => {
		if (!props.onStatsChange) {
			return
		}
		let membersInView = 0
		let totalIncome = 0
		let totalTaxableIncome = 0
		for (const row of rows) {
			totalIncome += parseIsk(row.contributionIncome)
			totalTaxableIncome += parseIsk(row.taxableContributionIncome)
			if (row.characterId !== UNATTRIBUTED_CHARACTER_ID) {
				membersInView += 1
			}
		}
		props.onStatsChange({
			membersInView,
			totalIncome,
			totalTaxableIncome,
		})
	}, [rows, props.onStatsChange])

	return (
		<Card>
			<CardHeader>
				<CardTitle>Member Contribution Summary</CardTitle>
				<CardDescription>
					Aggregated from corporation wallet entries attributed to members in the selected period.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{!props.effectiveCorporationId ? (
					<div className="py-8 text-sm text-muted-foreground">
						Select a corporation to load member summaries.
					</div>
				) : (
					<MemberSummaryReportGrid
						rows={rows}
						loading={isLoading || isFetching}
						error={error}
						entityNames={entityNames}
						sorting={grid.sorting}
						onSortingChange={grid.onSortingChange}
						pagination={grid.pagination}
						onPaginationChange={grid.onPaginationChange}
						pageCount={pageCount}
						rowCount={totalRows}
					/>
				)}
			</CardContent>
		</Card>
	)
}
