import { useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useCorporationAccess } from '@/features/my-corporations'
import {
	useTaxCapabilities,
	useTaxCorporations,
	useTaxMemberSummary,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import { formatTaxRefTypeLabel, TaxEntityDisplay } from '@/lib/tax-display'

import type { TaxMemberComplianceStatus } from '@repo/corporation-tax'

function parseIsk(value: string): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function formatIsk(value: number): string {
	return value.toFixed(2)
}

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()

function toStatusVariant(
	status: TaxMemberComplianceStatus
): 'default' | 'destructive' | 'secondary' | 'outline' {
	if (status === 'underpaid') {
		return 'destructive'
	}
	if (status === 'overpaid') {
		return 'secondary'
	}
	if (status === 'paid') {
		return 'default'
	}
	return 'outline'
}

export default function TaxMemberSummaryPage() {
	usePageTitle('Tax Member Summary')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canReadWithUrn = globalCapabilities?.global.canRead ?? false
	const { data: corporationAccess } = useCorporationAccess()

	const { data: corporationSettings = [] } = useTaxCorporations({
		limit: 200,
		enabled: canReadWithUrn,
	})

	const corporationOptions = useMemo(() => {
		const map = new Map<string, string>()
		for (const corp of corporationAccess?.corporations ?? []) {
			map.set(corp.corporationId, corp.name)
		}
		for (const setting of corporationSettings) {
			if (!map.has(setting.corporationId)) {
				map.set(setting.corporationId, setting.corporationId)
			}
		}
		return Array.from(map.entries()).map(([corporationId, name]) => ({ corporationId, name }))
	}, [corporationAccess?.corporations, corporationSettings])

	const [selectedCorporationId, setSelectedCorporationId] = useState<string | undefined>(undefined)
	const [characterId, setCharacterId] = useState('')
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)

	const effectiveCorporationId = useMemo(() => {
		if (selectedCorporationId) {
			return selectedCorporationId
		}
		if (corporationOptions.length > 0) {
			return corporationOptions[0]?.corporationId
		}
		return undefined
	}, [selectedCorporationId, corporationOptions])

	const { data: scopedCapabilities } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canChooseCharacter =
		canReadWithUrn ||
		(scopedCapabilities?.scoped.canRead ?? false) ||
		(corporationAccess?.hasAccess ?? false)

	const {
		data: summaries = [],
		isLoading,
		error,
	} = useTaxMemberSummary(effectiveCorporationId, {
		characterId: canChooseCharacter ? characterId.trim() || undefined : undefined,
		fromDate: fromDate ? new Date(`${fromDate}T00:00:00.000Z`).toISOString() : undefined,
		toDate: toDate ? new Date(`${toDate}T23:59:59.999Z`).toISOString() : undefined,
		topRefTypesLimit: 5,
		enabled: !!effectiveCorporationId,
	})

	const totals = summaries.reduce(
		(acc, row) => {
			acc.taxDue += parseIsk(row.taxDue)
			acc.taxPaid += parseIsk(row.taxPaid)
			acc.taxDelta += parseIsk(row.taxDelta)
			acc.assessments += row.assessmentCount
			return acc
		},
		{ taxDue: 0, taxPaid: 0, taxDelta: 0, assessments: 0 }
	)

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of summaries) {
			ids.add(row.corporationId)
			ids.add(row.characterId)
		}
		return [...ids]
	}, [summaries])

	const { data: entityNames = {} } = useEntityNames(entityIds, {
		enabled: Boolean(effectiveCorporationId),
	})

	return (
		<Container>
			<PageHeader
				title="Tax Member Summary"
				description="View member-level tax totals and top taxable income sources for a corporation."
			/>

			<Section>
				{corporationOptions.length > 0 ? (
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
							By default, results are limited to your member characters in the selected corporation.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-3">
						<DateRangeInput
							value={{ fromDate, toDate }}
							onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
								setFromDate(nextFromDate)
								setToDate(nextToDate)
							}}
							placeholder="Date range"
						/>
						<Input
							value={characterId}
							onChange={(event) => setCharacterId(event.target.value)}
							placeholder="Character ID (optional)"
							disabled={!canChooseCharacter}
						/>
					</CardContent>
				</Card>

				<div className="grid gap-4 md:grid-cols-4">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Members in View</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{summaries.length}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Assessments</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{totals.assessments}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Tax Due</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{formatIsk(totals.taxDue)}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Tax Delta</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">
							{formatIsk(totals.taxDelta)}
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Member Summaries</CardTitle>
						<CardDescription>
							Top income types are derived from member-scoped tax assessment lines.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to load member summaries.
							</div>
						) : isLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading member summaries...</div>
						) : error ? (
							<div className="py-8 text-sm text-destructive">
								{error instanceof Error ? error.message : 'Failed to load member summaries'}
							</div>
						) : summaries.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No member summary records were found for the selected scope and period.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Character</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Assessments</TableHead>
										<TableHead>Tax Due</TableHead>
										<TableHead>Tax Paid</TableHead>
										<TableHead>Tax Delta</TableHead>
										<TableHead>Last Assessment</TableHead>
										<TableHead>Top Sources</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{summaries.map((row) => (
										<TableRow key={`${row.corporationId}:${row.characterId}`}>
											<TableCell>
												<TaxEntityDisplay entityId={row.characterId} entityNames={entityNames} />
											</TableCell>
											<TableCell>
												<Badge variant={toStatusVariant(row.complianceStatus)}>
													{row.complianceStatus}
												</Badge>
											</TableCell>
											<TableCell>{row.assessmentCount}</TableCell>
											<TableCell>{row.taxDue}</TableCell>
											<TableCell>{row.taxPaid}</TableCell>
											<TableCell>{row.taxDelta}</TableCell>
											<TableCell>{formatTaxDateTime(row.lastAssessmentAt)}</TableCell>
											<TableCell className="max-w-[360px] text-xs">
												{row.topRefTypes.length === 0
													? '-'
													: row.topRefTypes
															.map(
																(item) =>
																	`${formatTaxRefTypeLabel(item.refType)} (${item.taxableAmount})`
															)
															.join(', ')}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
