import { useState } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { Switch } from '@/components/ui/switch'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { SRPFeedback } from '../components/SRPFeedback'
import { useAcknowledgeSrpPaymentMismatchAlert, useSrpPaymentMismatchAlerts } from '../hooks'
import { formatISK } from '../utils'

import type { SRPPaymentMismatchAlert } from '../types'

export default function SRPAlertsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('srp.alerts.pageTitle'))

	const { hasAnyPermission } = useUserPermissions()
	const [includeAcknowledged, setIncludeAcknowledged] = useState(false)
	const { data, isLoading, error } = useSrpPaymentMismatchAlerts({
		includeAcknowledged,
		limit: 100,
		offset: 0,
	})
	const acknowledgeAlert = useAcknowledgeSrpPaymentMismatchAlert()

	if (!hasAnyPermission('urn:srp:payer', 'urn:srp:manager')) {
		return <Navigate to="/srp" replace />
	}

	if (isLoading) {
		return (
			<Container>
				<PageHeader title={t('srp.alerts.title')} description={t('srp.alerts.description')} />
				<Card className="mt-4">
					<CardContent className="space-y-2 p-4">
						{[...Array(3)].map((_, idx) => (
							<div key={idx} className="h-14 animate-pulse rounded-md bg-muted/30" />
						))}
					</CardContent>
				</Card>
			</Container>
		)
	}

	if (error) {
		return (
			<Container>
				<PageHeader title={t('srp.alerts.title')} description={t('srp.alerts.description')} />
				<Card className="mt-4 border-red-500/50 bg-red-500/10">
					<CardContent className="p-6 text-center text-sm text-red-500">
						{t('srp.alerts.loadFailed')}
					</CardContent>
				</Card>
			</Container>
		)
	}

	const alerts: SRPPaymentMismatchAlert[] = data?.alerts ?? []

	const onAcknowledge = async (alertId: string) => {
		try {
			await acknowledgeAlert.mutateAsync(alertId)
			toast.success(<SRPFeedback messageKey="srp.alerts.acknowledged" />)
		} catch (err: any) {
			toast.error(<SRPFeedback messageKey="srp.alerts.acknowledgeFailed" />, {
				description: err?.message ?? t('srp.common.unknownError'),
			})
		}
	}

	return (
		<Container>
			<PageHeader title={t('srp.alerts.title')} description={t('srp.alerts.description')} />
			<div className="mt-4 flex items-center justify-between">
				<div className="text-sm text-muted-foreground">
					{t('srp.alerts.count', { count: data?.total ?? 0 })}
				</div>
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">{t('srp.alerts.showAcknowledged')}</span>
					<Switch checked={includeAcknowledged} onCheckedChange={setIncludeAcknowledged} />
				</div>
			</div>

			<Card className="mt-3">
				<CardContent className="p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t('srp.alerts.detected')}</TableHead>
								<TableHead>{t('srp.common.request')}</TableHead>
								<TableHead>{t('srp.alerts.expectedActual')}</TableHead>
								<TableHead>{t('srp.alerts.payee')}</TableHead>
								<TableHead>{t('srp.alerts.payer')}</TableHead>
								<TableHead>{t('srp.common.status')}</TableHead>
								<TableHead className="text-right">{t('srp.common.action')}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{alerts.length === 0 ? (
								<TableRow>
									<TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
										{t('srp.alerts.empty')}
									</TableCell>
								</TableRow>
							) : (
								alerts.map((alert) => (
									<TableRow key={alert.id}>
										<TableCell className="text-sm">
											<EveTimeDisplay dateStr={alert.detectedAt} />
										</TableCell>
										<TableCell className="text-sm">
											<Link
												to={`/srp/request/${alert.requestId}`}
												className="text-primary hover:underline"
											>
												{alert.requestId}
											</Link>
											<div className="mt-1 font-mono text-xs text-muted-foreground">
												{t('srp.alerts.journal', { id: alert.journalId })}
											</div>
										</TableCell>
										<TableCell className="text-sm">
											<div className="font-mono text-xs">
												{t('srp.alerts.expected', { value: formatISK(alert.expectedAmount) })}
											</div>
											<div className="font-mono text-xs text-warning">
												{t('srp.alerts.actual', { value: formatISK(alert.observedAmount) })}
											</div>
										</TableCell>
										<TableCell className="text-xs">
											<div>{alert.actualRecipientCharacterName ?? t('srp.common.unknown')}</div>
											<div className="text-muted-foreground">
												{t('srp.alerts.expected', {
													value:
														alert.expectedRecipientCharacterName ??
														alert.expectedRecipientCharacterId,
												})}
											</div>
										</TableCell>
										<TableCell className="text-xs">
											{alert.actualPayerName ?? alert.actualPayerId ?? t('srp.common.unknown')}
										</TableCell>
										<TableCell className="text-xs">
											{alert.state === 'acknowledged' ? (
												<span className="text-muted-foreground">
													{t('srp.alerts.acknowledgedStatus')}
												</span>
											) : (
												<span className="text-warning">{t('srp.alerts.open')}</span>
											)}
										</TableCell>
										<TableCell className="text-right">
											{alert.state === 'acknowledged' ? (
												<span className="text-xs text-muted-foreground">—</span>
											) : (
												<Button
													size="sm"
													variant="secondary"
													onClick={() => onAcknowledge(alert.id)}
													disabled={acknowledgeAlert.isPending}
												>
													{t('srp.alerts.acknowledge')}
												</Button>
											)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</Container>
	)
}
