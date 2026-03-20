import { RefreshCcw } from 'lucide-react'
import { useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
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
import { useAuth } from '@/hooks/useAuth'
import {
	useAcknowledgeTaxAlert,
	useResolveTaxAlert,
	useRetryFailedTaxAlertDeliveries,
	useTaxAlerts,
	useTaxCapabilities,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime } from '@/lib/tax-date'
import {
	formatTaxAlertContext,
	formatTaxAlertTypeLabel,
	formatTaxNumber,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { TaxAlert, TaxAlertSeverity, TaxAlertStatus } from '@repo/corporation-tax'

const statusFilterOptions: Array<{ label: string; value?: TaxAlertStatus }> = [
	{ label: 'All', value: undefined },
	{ label: 'Open', value: 'open' },
	{ label: 'Acknowledged', value: 'acknowledged' },
	{ label: 'Resolved', value: 'resolved' },
]

const severityFilterOptions: Array<{ label: string; value?: TaxAlertSeverity }> = [
	{ label: 'All Severities', value: undefined },
	{ label: 'Critical', value: 'critical' },
	{ label: 'Warning', value: 'warning' },
	{ label: 'Info', value: 'info' },
]

function severityBadgeVariant(severity: TaxAlertSeverity): 'destructive' | 'warning' | 'outline' {
	if (severity === 'critical') {
		return 'destructive'
	}
	if (severity === 'warning') {
		return 'warning'
	}
	return 'outline'
}

function statusBadgeVariant(status: TaxAlertStatus): 'default' | 'secondary' | 'outline' {
	if (status === 'open') {
		return 'default'
	}
	if (status === 'acknowledged') {
		return 'secondary'
	}
	return 'outline'
}

export default function TaxAlertsPage() {
	usePageTitle('Tax Alerts')

	const { user } = useAuth()
	const isSiteAdmin = user?.is_admin === true
	const { data: globalCapabilities } = useTaxCapabilities()
	const canViewWithUrn = globalCapabilities?.global.canManage ?? false
	const canRetryFailedDeliveries = isSiteAdmin
	const showDeliveryTelemetry = isSiteAdmin
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canViewWithUrn)

	const [statusFilter, setStatusFilter] = useState<TaxAlertStatus | undefined>('open')
	const [severityFilter, setSeverityFilter] = useState<TaxAlertSeverity | undefined>(undefined)

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canManage ?? false
	const canAcknowledge =
		(globalCapabilities?.global.canManage ?? false) ||
		(scopedCapabilities?.scoped.canManage ?? false)
	const canResolve = canAcknowledge
	const canView = canViewWithUrn || canViewScoped

	const {
		data: alerts = [],
		isLoading,
		error,
	} = useTaxAlerts({
		corporationId: effectiveCorporationId,
		status: statusFilter,
		severity: severityFilter,
		limit: 100,
		enabled: canView,
	})

	const corporationIds = alerts
		.map((alert) => alert.corporationId)
		.filter((corporationId): corporationId is string => Boolean(corporationId))

	const { data: entityNames = {} } = useEntityNames(corporationIds, { enabled: canView })

	const acknowledgeMutation = useAcknowledgeTaxAlert()
	const resolveMutation = useResolveTaxAlert()
	const retryMutation = useRetryFailedTaxAlertDeliveries()

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Alerts</CardTitle>
						<CardDescription>You do not have permission to view tax alerts.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	if (!canViewWithUrn && !corporationAccessLoading && !effectiveCorporationId) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Alerts</CardTitle>
						<CardDescription>
							No corporation self-service scope was found for this account.
						</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	const openCount = alerts.filter((alert) => alert.status === 'open').length
	const failedDeliveryCount = alerts.filter(
		(alert) => alert.discordDeliveryStatus === 'failed'
	).length
	const criticalCount = alerts.filter((alert) => alert.severity === 'critical').length

	return (
		<Container>
			<PageHeader
				title="Tax Alerts"
				description="Monitor discrepancy alerts and delivery status for corporation tax automation."
				action={
					canRetryFailedDeliveries ? (
						<Button
							variant="outline"
							onClick={() => retryMutation.mutate(100)}
							disabled={retryMutation.isPending}
						>
							<RefreshCcw className="mr-2 h-4 w-4" />
							Retry Failed Deliveries
						</Button>
					) : undefined
				}
			/>

			<Section>
				<div
					className={`grid gap-4 ${showDeliveryTelemetry ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
				>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Open Alerts</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{openCount}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Critical Alerts</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{criticalCount}</CardContent>
					</Card>
					{showDeliveryTelemetry ? (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Failed Discord Deliveries</CardTitle>
							</CardHeader>
							<CardContent className="text-2xl font-semibold">{failedDeliveryCount}</CardContent>
						</Card>
					) : null}
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Alert Inbox</CardTitle>
						<CardDescription>
							Filter and manage alert lifecycle for tax discrepancy and ingestion events.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<TaxCorporationScopeSelector
							corporations={accessibleCorporations}
							effectiveCorporationId={effectiveCorporationId}
							selectedCorporationId={selectedCorporationId}
							canSelectAll={canViewWithUrn}
							onSelect={setSelectedCorporationId}
						/>

						<div className="flex flex-wrap gap-2">
							{statusFilterOptions.map((option) => (
								<Button
									key={`status-${option.label}`}
									size="sm"
									variant={statusFilter === option.value ? 'default' : 'outline'}
									onClick={() => setStatusFilter(option.value)}
								>
									{option.label}
								</Button>
							))}
						</div>

						<div className="flex flex-wrap gap-2">
							{severityFilterOptions.map((option) => (
								<Button
									key={`severity-${option.label}`}
									size="sm"
									variant={severityFilter === option.value ? 'default' : 'outline'}
									onClick={() => setSeverityFilter(option.value)}
								>
									{option.label}
								</Button>
							))}
						</div>

						{isLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading alerts...</div>
						) : error ? (
							<div className="py-8 text-sm text-destructive">
								{error instanceof Error ? error.message : 'Failed to load tax alerts'}
							</div>
						) : alerts.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No alerts matched the current filters.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Alert</TableHead>
										<TableHead>Severity</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Corporation</TableHead>
										<TableHead>Last Triggered</TableHead>
										{showDeliveryTelemetry ? <TableHead>Discord Delivery</TableHead> : null}
										<TableHead>Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{alerts.map((alert: TaxAlert) => (
										<TableRow key={alert.id}>
											<TableCell className="font-medium">
												<div className="space-y-1">
													<div>{formatTaxAlertTypeLabel(alert.alertType)}</div>
													<div className="text-xs text-muted-foreground">
														{formatTaxAlertContext(alert, entityNames)}
													</div>
												</div>
											</TableCell>
											<TableCell>
												<Badge variant={severityBadgeVariant(alert.severity)}>
													{alert.severity}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={statusBadgeVariant(alert.status)}>{alert.status}</Badge>
											</TableCell>
											<TableCell>
												{alert.corporationId ? (
													<TaxEntityDisplay
														entityId={alert.corporationId}
														entityNames={entityNames}
													/>
												) : (
													'Global'
												)}
											</TableCell>
											<TableCell>{formatTaxDateTime(alert.lastTriggeredAt)}</TableCell>
											{showDeliveryTelemetry ? (
												<TableCell>
													<div className="text-sm">
														<div>{alert.discordDeliveryStatus}</div>
														<div className="text-xs text-muted-foreground">
															attempts: {formatTaxNumber(alert.discordAttemptCount)}
														</div>
													</div>
												</TableCell>
											) : null}
											<TableCell>
												<div className="flex gap-2">
													{canAcknowledge && alert.status === 'open' ? (
														<Button
															size="sm"
															variant="outline"
															onClick={() => acknowledgeMutation.mutate(alert.id)}
															disabled={acknowledgeMutation.isPending}
														>
															Acknowledge
														</Button>
													) : null}
													{canResolve && alert.status !== 'resolved' ? (
														<Button
															size="sm"
															onClick={() => resolveMutation.mutate(alert.id)}
															disabled={resolveMutation.isPending}
														>
															Resolve
														</Button>
													) : null}
												</div>
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
