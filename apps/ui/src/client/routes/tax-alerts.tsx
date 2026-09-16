import { RefreshCcw } from 'lucide-react'
import { useEffect, useState } from 'react'

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
import { i18n, useAppTranslation } from '@/i18n'
import { formatTaxDateTime } from '@/lib/tax-date'
import {
	formatTaxAlertContext,
	formatTaxAlertPayloadSummary,
	formatTaxAlertTypeLabel,
	formatTaxNumber,
	formatTaxStatus,
	TaxCorporationDisplay,
} from '@/lib/tax-display'
import toast from '@/lib/toast'

import type { TaxAlert, TaxAlertSeverity, TaxAlertStatus } from '@repo/corporation-tax'

const statusFilterOptions: Array<{ label: string; value?: TaxAlertStatus }> = [
	{
		get label() {
			return i18n.t('tax.all')
		},
		value: undefined,
	},
	{
		get label() {
			return i18n.t('tax.open')
		},
		value: 'open',
	},
	{
		get label() {
			return i18n.t('tax.acknowledged')
		},
		value: 'acknowledged',
	},
	{
		get label() {
			return i18n.t('tax.resolved')
		},
		value: 'resolved',
	},
]

const severityFilterOptions: Array<{ label: string; value?: TaxAlertSeverity }> = [
	{
		get label() {
			return i18n.t('tax.allSeverities')
		},
		value: undefined,
	},
	{
		get label() {
			return i18n.t('tax.critical')
		},
		value: 'critical',
	},
	{
		get label() {
			return i18n.t('tax.warning')
		},
		value: 'warning',
	},
	{
		get label() {
			return i18n.t('tax.info')
		},
		value: 'info',
	},
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
	const { t } = useAppTranslation()

	usePageTitle(t('tax.taxAlerts'))

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
						<CardTitle>{t('tax.taxAlerts')}</CardTitle>
						<CardDescription>{t('tax.youDoNotHavePermissionToViewTaxAlerts')}</CardDescription>
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
						<CardTitle>{t('tax.taxAlerts')}</CardTitle>
						<CardDescription>
							{t('tax.noCorporationSelfServiceScopeWasFoundForThisAccount')}
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
			toast.error(t('tax.nameGuildIdAndChannelIdAreRequired'))
			return
		}
		try {
			await upsertDestinationMutation.mutateAsync({
				name: trimmedName,
				guildId: trimmedGuildId,
				channelId: trimmedChannelId,
			})
			toast.success(t('tax.discordAlertDestinationSaved'))
			setDestinationModalOpen(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('tax.failedToSaveDiscordDestination'))
		}
	}

	return (
		<Container>
			<PageHeader
				title={t('tax.taxAlerts')}
				description={t('tax.monitorDiscrepancyAlertsAndDeliveryStatusForCorporationTaxAutomation')}
				action={
					canRetryFailedDeliveries ? (
						<Button
							variant="ghost"
							onClick={() => retryMutation.mutate(100)}
							disabled={retryMutation.isPending}
						>
							<RefreshCcw className="h-4 w-4" />
							{t('tax.retryFailedDeliveries')}
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
							<CardTitle className="text-sm">{t('tax.openAlerts')}</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{openCount}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">{t('tax.criticalAlerts')}</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{criticalCount}</CardContent>
					</Card>
					{showDeliveryTelemetry ? (
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">{t('tax.failedDiscordDeliveries')}</CardTitle>
							</CardHeader>
							<CardContent className="text-2xl font-semibold">{failedDeliveryCount}</CardContent>
						</Card>
					) : null}
				</div>

				<Card>
					<CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1">
							<CardTitle>{t('tax.alertInbox')}</CardTitle>
							<CardDescription>
								{t('tax.filterAndManageAlertLifecycleForTaxDiscrepancyAndIngestion')}
							</CardDescription>
						</div>
						{canConfigureDestination ? (
							<div className="flex flex-col items-start gap-2 sm:items-end">
								<div className="text-xs text-muted-foreground sm:text-right">
									{destinationLoading
										? t('tax.loadingDestination')
										: destinationError
											? t('tax.failedToLoadDestination')
											: currentDestination
												? t('tax.discordDestinationSummary', {
														name: currentDestination.name,
														guildId: currentDestination.guildId,
														channelId: currentDestination.channelId,
													})
												: t('tax.noDiscordDestinationConfigured')}
								</div>
								<Button
									variant="ghost"
									onClick={() => {
										setDestinationName(currentDestination?.name ?? '')
										setGuildId(currentDestination?.guildId ?? '')
										setChannelId(currentDestination?.channelId ?? '')
										setDestinationModalOpen(true)
									}}
								>
									{t('tax.editDiscordDestination')}
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
							<div className="py-8 text-sm text-muted-foreground">{t('tax.loadingAlerts')}</div>
						) : error ? (
							<div className="py-8 text-sm text-destructive">
								{error instanceof Error ? error.message : t('tax.failedToLoadTaxAlerts')}
							</div>
						) : alerts.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								{t('tax.noAlertsMatchedTheCurrentFilters')}
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('tax.alert')}</TableHead>
										<TableHead>{t('tax.severity')}</TableHead>
										<TableHead>{t('tax.status')}</TableHead>
										<TableHead>{t('tax.corporation')}</TableHead>
										<TableHead>{t('tax.lastTriggered')}</TableHead>
										{showDeliveryTelemetry ? (
											<TableHead>{t('tax.discordDelivery')}</TableHead>
										) : null}
										<TableHead>{t('tax.actions')}</TableHead>
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
														{formatTaxStatus(alert.severity)}
													</Badge>
												</TableCell>
												<TableCell>
													<Badge variant={statusBadgeVariant(alert.status)}>
														{formatTaxStatus(alert.status)}
													</Badge>
												</TableCell>
												<TableCell>
													{alert.corporationId ? (
														<TaxCorporationDisplay
															corporationId={alert.corporationId}
															entityNames={entityNames}
														/>
													) : (
														t('tax.global')
													)}
												</TableCell>
												<TableCell>{formatTaxDateTime(alert.lastTriggeredAt)}</TableCell>
												{showDeliveryTelemetry ? (
													<TableCell>
														<div className="text-sm">
															<div>{formatTaxStatus(alert.discordDeliveryStatus)}</div>
															<div className="text-xs text-muted-foreground">
																{t('tax.attempts')}
																{formatTaxNumber(alert.discordAttemptCount)}
															</div>
														</div>
													</TableCell>
												) : null}
												<TableCell>
													<div className="flex gap-2">
														{canAcknowledge && alert.status === 'open' ? (
															<Button
																variant="primary"
																size="sm"
																onClick={() => acknowledgeMutation.mutate(alert.id)}
																disabled={acknowledgeMutation.isPending}
															>
																{t('tax.acknowledge')}
															</Button>
														) : null}
														{canResolve && alert.status !== 'resolved' ? (
															<Button
																variant="confirm"
																size="sm"
																showIcon={false}
																onClick={() => resolveMutation.mutate(alert.id)}
																disabled={resolveMutation.isPending}
															>
																{t('tax.resolve')}
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
								<DialogTitle>{t('tax.editDiscordDestination')}</DialogTitle>
								<DialogDescription>
									{t('tax.setTheGlobalDestinationUsedForAllTaxAlerts')}
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4">
								<div className="space-y-1.5">
									<Label htmlFor="tax-alert-destination-name">{t('tax.destinationName')}</Label>
									<Input
										id="tax-alert-destination-name"
										value={destinationName}
										onChange={(event) => setDestinationName(event.target.value)}
										placeholder={t('tax.allianceTaxAlerts')}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="tax-alert-destination-guild-id">{t('tax.guildId')}</Label>
									<Input
										id="tax-alert-destination-guild-id"
										value={guildId}
										onChange={(event) => setGuildId(event.target.value)}
										placeholder={t('tax.discordGuildId')}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="tax-alert-destination-channel-id">{t('tax.channelId')}</Label>
									<Input
										id="tax-alert-destination-channel-id"
										value={channelId}
										onChange={(event) => setChannelId(event.target.value)}
										placeholder={t('tax.discordChannelId')}
									/>
								</div>
							</div>
							<DialogFooter>
								<Button
									variant="cancel"
									type="button"
									showIcon={false}
									onClick={() => setDestinationModalOpen(false)}
								>
									{t('tax.cancel')}
								</Button>
								<Button
									variant="primary"
									type="button"
									disabled={upsertDestinationMutation.isPending}
									onClick={() => void handleSaveDestination()}
								>
									{upsertDestinationMutation.isPending
										? t('tax.savingDestination')
										: t('tax.saveDestination')}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				) : null}
			</Section>
		</Container>
	)
}
