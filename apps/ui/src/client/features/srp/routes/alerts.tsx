import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import toast from '@/lib/toast'

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
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useAcknowledgeSrpPaymentMismatchAlert, useSrpPaymentMismatchAlerts } from '../hooks'
import { formatISK } from '../utils'

import type { SRPPaymentMismatchAlert } from '../types'

export default function SRPAlertsPage() {
	usePageTitle('SRP - Alerts')

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
			<PageHeader title="SRP Alerts" description="Payment mismatches that require review" />
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
			<PageHeader title="SRP Alerts" description="Payment mismatches that require review" />
			<Card className="mt-4 border-red-500/50 bg-red-500/10">
				<CardContent className="p-6 text-center text-sm text-red-500">
					Failed to load SRP payment alerts
				</CardContent>
			</Card>
		</Container>
	)
}

	const alerts: SRPPaymentMismatchAlert[] = data?.alerts ?? []

	const onAcknowledge = async (alertId: string) => {
		try {
			await acknowledgeAlert.mutateAsync(alertId)
			toast.success('Alert acknowledged')
		} catch (err: any) {
			toast.error('Failed to acknowledge alert', { description: err?.message ?? 'Unknown error' })
		}
	}

	return (
		<Container>
			<PageHeader title="SRP Alerts" description="Payment mismatches that require review" />
			<div className="mt-4 flex items-center justify-between">
				<div className="text-sm text-muted-foreground">{data?.total ?? 0} alerts</div>
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">Show acknowledged</span>
					<Switch checked={includeAcknowledged} onCheckedChange={setIncludeAcknowledged} />
				</div>
			</div>

			<Card className="mt-3">
				<CardContent className="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Detected</TableHead>
							<TableHead>Request</TableHead>
							<TableHead>Expected / Actual</TableHead>
							<TableHead>Payee</TableHead>
							<TableHead>Payer</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Action</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{alerts.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
									No payment mismatch alerts
								</TableCell>
							</TableRow>
						) : (
							alerts.map((alert) => (
								<TableRow key={alert.id}>
									<TableCell className="text-sm">
										<EveTimeDisplay dateStr={alert.detectedAt} />
									</TableCell>
									<TableCell className="text-sm">
										<Link to={`/srp/request/${alert.requestId}`} className="text-primary hover:underline">
											{alert.requestId.slice(0, 8)}...
										</Link>
										<div className="mt-1 font-mono text-xs text-muted-foreground">
											Journal {alert.journalId}
										</div>
									</TableCell>
									<TableCell className="text-sm">
										<div className="font-mono text-xs">
											Expected {formatISK(alert.expectedAmount)}
										</div>
										<div className="font-mono text-xs text-warning">
											Actual {formatISK(alert.observedAmount)}
										</div>
									</TableCell>
									<TableCell className="text-xs">
										<div>{alert.actualRecipientCharacterName ?? 'Unknown'}</div>
										<div className="text-muted-foreground">
											Expected {alert.expectedRecipientCharacterName ?? alert.expectedRecipientCharacterId}
										</div>
									</TableCell>
									<TableCell className="text-xs">
										{alert.actualPayerName ?? alert.actualPayerId ?? 'Unknown'}
									</TableCell>
									<TableCell className="text-xs">
										{alert.state === 'acknowledged' ? (
											<span className="text-muted-foreground">Acknowledged</span>
										) : (
											<span className="text-warning">Open</span>
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
												Acknowledge
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
