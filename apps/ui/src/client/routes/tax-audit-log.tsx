import { useQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { TaxAuditLogGrid } from '@/components/tax-reports/grids'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useTaxAuditLog, useTaxCapabilities } from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { api } from '@/lib/api'

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
	const [actionFilter, setActionFilter] = useState('')
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
		isLoading,
		error,
	} = useTaxAuditLog({
		corporationId: effectiveCorporationId,
		actorUserId: actorUserIdFilter.trim() || undefined,
		action: actionFilter.trim() || undefined,
		limit: grid.limit,
		offset: grid.offset,
		enabled: canView,
	})
	const auditLogRows = auditLogPage?.rows ?? []
	const totalRows = auditLogPage?.totalRows ?? 0
	const pageCount = grid.pageCountFor(totalRows)

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
		() => Array.from(new Set(auditLogRows.map((entry) => entry.actorUserId).filter(Boolean))),
		[auditLogRows]
	)
	const actorNameQueries = useQueries({
		queries: actorIds.map((actorUserId) => ({
			queryKey: ['admin', 'users', 'audit-actor', actorUserId],
			queryFn: async () => {
				const result = await api.getAdminUsers({
					search: actorUserId,
					page: 1,
					pageSize: 1,
				})
				const exact = result.data.find((user) => user.id === actorUserId)
				return exact?.mainCharacterName || null
			},
			enabled: canAdminScope,
			staleTime: 1000 * 60 * 5,
		})),
	})
	const actorDisplayNames = useMemo(() => {
		const next: Record<string, string> = {}
		for (const [index, actorUserId] of actorIds.entries()) {
			const actorName = actorNameQueries[index]?.data
			if (actorName) {
				next[actorUserId] = actorName
			}
		}
		return next
	}, [actorIds, actorNameQueries])

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

	const changeCount = auditLogRows.filter((entry) => entry.before || entry.after).length

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

				<div className="grid gap-4 md:grid-cols-2">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Visible Entries</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{totalRows}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Entries With Change Payload</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{changeCount}</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Filters</CardTitle>
						<CardDescription>Filter by actor user ID and exact action key.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-2">
						<Input
							value={actorUserIdFilter}
							onChange={(event) => setActorUserIdFilter(event.target.value)}
							placeholder="Actor user ID"
						/>
						<Input
							value={actionFilter}
							onChange={(event) => setActionFilter(event.target.value)}
							placeholder="Action (example: tax.settings.updated)"
						/>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Audit Entries</CardTitle>
						<CardDescription>Most recent entries first.</CardDescription>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading audit log...</div>
						) : error ? (
							<div className="py-8 text-sm text-destructive">
								{error instanceof Error ? error.message : 'Failed to load tax audit log'}
							</div>
						) : auditLogRows.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No audit entries matched the selected filters.
							</div>
						) : (
							<TaxAuditLogGrid
								rows={auditLogRows}
								loading={isLoading}
								error={error}
								entityNames={entityNames}
								actorDisplayNames={actorDisplayNames}
								pagination={grid.pagination}
								onPaginationChange={grid.onPaginationChange}
								pageCount={pageCount}
								rowCount={totalRows}
							/>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
