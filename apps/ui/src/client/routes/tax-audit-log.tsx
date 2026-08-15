import { useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { TaxAuditLogGrid } from '@/components/tax-reports/grids'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import { useTaxAuditActors, useTaxAuditLog, useTaxCapabilities } from '@/hooks/corporation-tax'
import { useDebounce } from '@/hooks/useDebounce'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'

export default function TaxAuditLogPage() {
	usePageTitle('Tax Audit Log')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canAdminScope = globalCapabilities?.global.canManage ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canAdminScope)
	const [actorUserIdFilter, setActorUserIdFilter] = useState('')
	const [actorUserQuery, setActorUserQuery] = useState('')
	const [actionFilter, setActionFilter] = useState('')
	const debouncedActorUserQuery = useDebounce(actorUserQuery, 300)
	const normalizedActorQuery = debouncedActorUserQuery.trim()
	const actorSearchPending = actorUserQuery !== debouncedActorUserQuery
	const grid = useReportGridState({
		defaultSortBy: 'createdAt',
		defaultSortDir: 'desc',
		defaultPageSize: 50,
		resetOn: {
			effectiveCorporationId,
			actorUserIdFilter,
			actionFilter,
		},
	})

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canManage ?? false
	const canView = canAdminScope || canViewScoped

	const {
		data: auditLogPage,
		isFetching: isLoading,
		error,
	} = useTaxAuditLog({
		corporationId: effectiveCorporationId,
		actorUserId: actorUserIdFilter.trim() || undefined,
		action: actionFilter.trim() || undefined,
		limit: grid.limit,
		offset: grid.offset,
		sortBy: grid.sortBy as 'createdAt' | 'corporationId' | 'actorUserId' | 'action',
		sortDir: grid.sortDir,
		enabled: canView,
	})
	const auditLogRows = auditLogPage?.rows ?? []
	const totalRows = auditLogPage?.totalRows ?? 0

	const corporationIds = useMemo(
		() =>
			Array.from(
				new Set(
					auditLogRows
						.map((entry) => entry.corporationId)
						.filter((corporationId): corporationId is string => Boolean(corporationId))
				)
			),
		[auditLogRows]
	)
	const { data: entityNames = {} } = useEntityNames(corporationIds, {
		enabled: canView,
	})

	const actorIds = useMemo(
		() =>
			Array.from(
				new Set(
					[
						...auditLogRows.map((entry) => entry.actorUserId).filter(Boolean),
						actorUserIdFilter || null,
					].filter(Boolean)
				)
			) as string[],
		[auditLogRows, actorUserIdFilter]
	)
	const { data: resolvedActors = [] } = useTaxAuditActors({
		corporationId: effectiveCorporationId,
		ids: actorIds,
		limit: Math.max(actorIds.length, 1),
		enabled: canView && actorIds.length > 0,
	})
	const { data: actorSearchResults = [], isLoading: actorSearchLoading } = useTaxAuditActors({
		corporationId: effectiveCorporationId,
		q: normalizedActorQuery,
		limit: 25,
		enabled: canView && normalizedActorQuery.length >= 2,
	})
	const actorDisplayNames = useMemo(() => {
		const next: Record<string, string> = {}
		for (const actor of resolvedActors) {
			if (actor.name) next[actor.userId] = actor.name
		}
		return next
	}, [resolvedActors])
	const actorSearchOptions = useMemo(
		() =>
			actorSearchResults.map((actor) => ({
				value: actor.userId,
				label: actor.name ?? actor.userId,
				description: actor.name ? actor.userId : undefined,
			})),
		[actorSearchResults]
	)

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Audit Log</CardTitle>
						<CardDescription>You do not have permission to view tax audit entries.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title="Tax Audit Log"
				description="Review configuration and operational actions recorded by the taxation domain."
			/>

			<Section>
				<TaxCorporationScopeSelector
					corporations={accessibleCorporations}
					effectiveCorporationId={effectiveCorporationId}
					selectedCorporationId={selectedCorporationId}
					canSelectAll={canAdminScope}
					onSelect={setSelectedCorporationId}
				/>

				<Card>
					<CardHeader>
						<CardTitle>Filters</CardTitle>
						<CardDescription>Filter by actor and action key (partial match).</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-2">
						<Select
							value={actorUserIdFilter}
							onValueChange={(nextValue) => {
								setActorUserIdFilter(nextValue)
							}}
							query={actorUserQuery}
							onQueryChange={(value) => {
								setActorUserQuery(value)
								if (!value.trim()) {
									setActorUserIdFilter('')
									return
								}
								setActorUserIdFilter('')
							}}
							searchable
							searchDelegate={() => actorSearchOptions}
							options={actorSearchOptions}
							minQueryLength={2}
							debounceMs={0}
							loading={actorSearchLoading || actorSearchPending}
							queryHintText="Type at least 2 characters to search actors"
							placeholder={
								actorUserIdFilter
									? (actorDisplayNames[actorUserIdFilter] ?? actorUserIdFilter)
									: 'Actor name or user ID'
							}
							emptyText="No actors found"
						/>
						<Input
							value={actionFilter}
							onChange={(event) => setActionFilter(event.target.value)}
							placeholder="Action contains (example: settings)"
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Audit Entries</CardTitle>
						<CardDescription>Most recent entries first.</CardDescription>
					</CardHeader>
					<CardContent>
						<TaxAuditLogGrid
							rows={auditLogRows}
							loading={isLoading}
							error={error}
							entityNames={entityNames}
							actorDisplayNames={actorDisplayNames}
							sorting={grid.sorting}
							onSortingChange={grid.onSortingChange}
							pagination={grid.pagination}
							onPaginationChange={grid.onPaginationChange}
							rowCount={totalRows}
						/>
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
