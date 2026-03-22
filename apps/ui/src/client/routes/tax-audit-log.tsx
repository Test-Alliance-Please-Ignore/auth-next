import { useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
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
import { useTaxAuditLog, useTaxCapabilities } from '@/hooks/corporation-tax'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime } from '@/lib/tax-date'

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

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canManage ?? false
	const canView = canAdminScope || canViewScoped

	const {
		data: auditLog = [],
		isLoading,
		error,
	} = useTaxAuditLog({
		corporationId: effectiveCorporationId,
		actorUserId: actorUserIdFilter.trim() || undefined,
		action: actionFilter.trim() || undefined,
		limit: 100,
		enabled: canView,
	})

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

	const changeCount = auditLog.filter((entry) => entry.before || entry.after).length

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
						<CardContent className="text-2xl font-semibold">{auditLog.length}</CardContent>
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
						) : auditLog.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No audit entries matched the selected filters.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Time</TableHead>
										<TableHead>Action</TableHead>
										<TableHead>Actor</TableHead>
										<TableHead>Corporation</TableHead>
										<TableHead>Payload</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{auditLog.map((entry) => (
										<TableRow key={entry.id}>
											<TableCell>{formatTaxDateTime(entry.createdAt)}</TableCell>
											<TableCell className="font-medium">{entry.action}</TableCell>
											<TableCell>{entry.actorUserId}</TableCell>
											<TableCell>{entry.corporationId ?? 'Global'}</TableCell>
											<TableCell>{entry.before || entry.after ? 'Recorded' : 'None'}</TableCell>
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
