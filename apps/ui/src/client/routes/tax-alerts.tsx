import { RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import toast from '@/lib/toast'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
	useAcknowledgeTaxAlert,
	useResolveTaxAlert,
	useRetryFailedTaxAlertDeliveries,
	useTaxAlerts,
	useTaxCapabilities,
	useTaxNotificationDestinations,
	useUpsertTaxNotificationDestination,
} from '@/hooks/corporation-tax'
import { useAuth } from '@/hooks/useAuth'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime } from '@/lib/tax-date'
import {
	formatTaxAlertContext,
	formatTaxAlertPayloadSummary,
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

function severityBadgeVariant(severity: TaxAlertSeverity): 'destructive' | 'warning' | 'ghost' {
	if (severity === 'critical') {
		return 'destructive'
	}
	if (severity === 'warning') {
		return 'warning'
	}
	return 'ghost'
}

function statusBadgeVariant(status: TaxAlertStatus): 'default' | 'secondary' | 'ghost' {
	if (status === 'open') {
		return 'default'
	}
	if (status === 'acknowledged') {
		return 'secondary'
	}
	return 'ghost'
}

export default function TaxAlertsPage() {
	usePageTitle('Tax Alerts')

	const { user } = useAuth()
	const isSiteAdmin = user?.is_admin === true
	const { data: globalCapabilities } = useTaxCapabilities()
	const canAdminScope = globalCapabilities?.global.canManage ?? false
	const canRetryFailedDeliveries = isSiteAdmin
	const showDeliveryTelemetry = isSiteAdmin
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canAdminScope)

	const [statusFilter, setStatusFilter] = useState<TaxAlertStatus | undefined>('open')
	const [severityFilter, setSeverityFilter] = useState<TaxAlertSeverity | undefined>(undefined)
	const [destinationModalOpen, setDestinationModalOpen] = useState(false)
	const [destinationName, setDestinationName] = useState('')
	const [guildId, setGuildId] = useState('')
	const [channelId, setChannelId] = useState('')

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canManage ?? false
	const canAcknowledge =
		(globalCapabilities?.global.canManage ?? false) ||
		(scopedCapabilities?.scoped.canManage ?? false)
	const canResolve = canAcknowledge
	const canView = canAdminScope || canViewScoped
	const canConfigureDestination = canAdminScope

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
	const {
		data: notificationDestinations = [],
		isLoading: destinationLoading,
		error: destinationError,
	} = useTaxNotificationDestinations({
		limit: 20,
		enabled: canConfigureDestination,
	})

	const corporationIds = alerts
		.map((alert) => alert.corporationId)
		.filter((corporationId): corporationId is string => Boolean(corporationId))

	const { data: entityNames = {} } = useEntityNames(corporationIds, { enabled: canView })

	const acknowledgeMutation = useAcknowledgeTaxAlert()
	const resolveMutation = useResolveTaxAlert()
	const retryMutation = useRetryFailedTaxAlertDeliveries()
	const upsertDestinationMutation = useUpsertTaxNotificationDestination()

	useEffect(() => {
		const first = notificationDestinations[0]
		if (!first) {
			setDestinationName('')
			setGuildId('')
			setChannelId('')
			return
		}
		setDestinationName(first.name)
		setGuildId(first.guildId)
		setChannelId(first.channelId)
	}, [notificationDestinations])

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

	if (!canAdminScope && !corporationAccessLoading && !effectiveCorporationId) {
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
	const currentDestination = notificationDestinations[0]

	const handleSaveDestination = async () => {
		const trimmedName = destinationName.trim()
		const trimmedGuildId = guildId.trim()
		const trimmedChannelId = channelId.trim()
		if (!trimmedName || !trimmedGuildId || !trimmedChannelId) {
			toast.error('Name, guild ID, and channel ID are required.')
			return
		}
		try {
			await upsertDestinationMutation.mutateAsync({
				name: trimmedName,
				guildId: trimmedGuildId,
				channelId: trimmedChannelId,
			})
			toast.success('Discord alert destination saved.')
			setDestinationModalOpen(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to save Discord destination.')
		}
	}

	return (
		<Container>
			<PageHeader
				title="Tax Alerts"
				description="Monitor discrepancy alerts and delivery status for corporation tax automation."
				action={
					canRetryFailedDeliveries ? (
						<Button variant="ghost"
							onClick={() => retryMutation.mutate(100)}
							disabled={retryMutation.isPending}
						>
							<RefreshCcw className="h-4 w-4" />
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
					<CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1">
							<CardTitle>Alert Inbox</CardTitle>
							<CardDescription>
								Filter and manage alert lifecycle for tax discrepancy and ingestion events.
							</CardDescription>
						</div>
						{canConfigureDestination ? (
							<div className="flex flex-col items-start gap-2 sm:items-end">
								<div className="text-xs text-muted-foreground sm:text-right">
									{destinationLoading
										? 'Loading destination...'
										: destinationError
											? 'Failed to load destination'
											: currentDestination
												? `${currentDestination.name} • Guild ${currentDestination.guildId} • Channel ${currentDestination.channelId}`
												: 'No Discord destination configured'}
								</div>
								<Button variant="ghost"
									onClick={() => {
										setDestinationName(currentDestination?.name ?? '')
										setGuildId(currentDestination?.guildId ?? '')
										setChannelId(currentDestination?.channelId ?? '')
										setDestinationModalOpen(true)
									}}
								>
									Edit Discord Destination
								</Button>
							</div>
						) : null}
					</CardHeader>
					<CardContent className="space-y-4">
						<TaxCorporationScopeSelector
							corporations={accessibleCorporations}
							effectiveCorporationId={effectiveCorporationId}
							selectedCorporationId={selectedCorporationId}
							canSelectAll={canAdminScope}
							onSelect={setSelectedCorporationId}
						/>

						<div className="flex flex-wrap gap-2">
							{statusFilterOptions.map((option) => (
								<Button
									key={`status-${option.label}`}
									size="sm"
									variant={statusFilter === option.value ? 'primary' : 'ghost'}
									onClick={() => setStatusFilter(option.value)}
								>
									{option.label}
								</Button>
							))}
							<div className="mx-1 hidden h-6 w-px bg-border sm:block" />
							{severityFilterOptions.map((option) => (
								<Button
									key={`severity-${option.label}`}
									size="sm"
									variant={severityFilter === option.value ? 'primary' : 'ghost'}
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
									{alerts.map((alert: TaxAlert) => {
										const payloadSummary = formatTaxAlertPayloadSummary(alert)
										return (
											<TableRow key={alert.id}>
												<TableCell className="font-medium">
													<div className="space-y-1">
														<div>{formatTaxAlertTypeLabel(alert.alertType)}</div>
														<div className="text-xs text-muted-foreground">
															{formatTaxAlertContext(alert, entityNames)}
														</div>
														{payloadSummary ? (
															<div className="text-xs text-muted-foreground">{payloadSummary}</div>
														) : null}
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
															<Button variant="primary"
																size="sm"
																onClick={() => acknowledgeMutation.mutate(alert.id)}
																disabled={acknowledgeMutation.isPending}
															>
																Acknowledge
															</Button>
														) : null}
														{canResolve && alert.status !== 'resolved' ? (
															<Button variant="confirm"
																size="sm"
																showIcon={false}
																onClick={() => resolveMutation.mutate(alert.id)}
																disabled={resolveMutation.isPending}
															>
																Resolve
															</Button>
														) : null}
													</div>
												</TableCell>
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				{canConfigureDestination ? (
					<Dialog open={destinationModalOpen} onOpenChange={setDestinationModalOpen}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Edit Discord Destination</DialogTitle>
								<DialogDescription>
									Set the global destination used for all tax alerts.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
								<div className="space-y-1.5">
									<Label htmlFor="tax-alert-destination-name">Destination Name</Label>
									<Input
										id="tax-alert-destination-name"
										value={destinationName}
										onChange={(event) => setDestinationName(event.target.value)}
										placeholder="Alliance Tax Alerts"
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="tax-alert-destination-guild-id">Guild ID</Label>
									<Input
										id="tax-alert-destination-guild-id"
										value={guildId}
										onChange={(event) => setGuildId(event.target.value)}
										placeholder="Discord guild ID"
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="tax-alert-destination-channel-id">Channel ID</Label>
									<Input
										id="tax-alert-destination-channel-id"
										value={channelId}
										onChange={(event) => setChannelId(event.target.value)}
										placeholder="Discord channel ID"
									/>
								</div>
							</div>
							<DialogFooter>
								<Button variant="cancel"
									type="button"
									showIcon={false}
									onClick={() => setDestinationModalOpen(false)}
								>
									Cancel
								</Button>
								<Button variant="primary"
									type="button"
									disabled={upsertDestinationMutation.isPending}
									onClick={() => void handleSaveDestination()}
								>
									{upsertDestinationMutation.isPending
										? 'Saving Destination...'
										: 'Save Destination'}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				) : null}
			</Section>
		</Container>
	)
}
