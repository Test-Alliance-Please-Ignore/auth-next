import { Navigate, useNavigate } from 'react-router-dom'

import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { typeIconUrl } from '@/lib/eve-images'

import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { useRequestsByStatus } from '../hooks'
import { formatISK, formatRelativeTime } from '../utils'

import type { RequestStatus, SRPRequestResponse } from '../types'

const TABS: Array<{ value: RequestStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'needs_context', label: 'Needs Context' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'paid', label: 'Paid' },
]

export default function ReviewQueue() {
	const { hasPermission, isAdmin } = useUserPermissions()

	if (!(isAdmin || hasPermission('urn:srp:reviewer'))) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader title="Review Queue" description="Review and process ship replacement requests" />

			<Card className="mt-section">
				<CardContent className="p-4">
					<Tabs defaultValue="pending">
						<TabsList className="w-full">
							{TABS.map((tab) => (
								<TabsTrigger key={tab.value} value={tab.value}>
									{tab.label}
								</TabsTrigger>
							))}
						</TabsList>

						{TABS.map((tab) => (
							<TabsContent key={tab.value} value={tab.value}>
								<ReviewTabContent status={tab.value} />
							</TabsContent>
						))}
					</Tabs>
				</CardContent>
			</Card>
		</Container>
	)
}

function ReviewTabContent({ status }: { status: RequestStatus }) {
	const { data, isLoading, error } = useRequestsByStatus(status, { limit: 50 })
	const navigate = useNavigate()

	if (isLoading) {
		return (
			<div className="space-y-2 pt-4">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted/30" />
				))}
			</div>
		)
	}

	if (error) {
		return (
			<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
				<p className="text-sm text-red-500">Failed to load requests</p>
			</div>
		)
	}

	const requests: SRPRequestResponse[] = data?.requests ?? []

	if (requests.length === 0) {
		return (
			<div className="mt-4 rounded-lg border border-dashed p-12 text-center">
				<p className="text-muted-foreground">No {status.replace('_', ' ')} requests</p>
			</div>
		)
	}

	return (
		<div className="mt-4">
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-14" />
							<TableHead>Ship</TableHead>
							<TableHead>Pilot</TableHead>
							<TableHead className="text-right">Payout / Value</TableHead>
							<TableHead>System</TableHead>
							<TableHead>Lost</TableHead>
							<TableHead>Submitted</TableHead>
							<TableHead>Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{requests.map((req) => (
							<TableRow
								key={req.id}
								className="cursor-pointer"
								onClick={() => navigate(`/srp/review/${req.id}`)}
							>
								<TableCell className="py-2">
									{req.shipTypeId && (
										<img
											src={typeIconUrl(req.shipTypeId, 32)}
											alt={req.shipTypeName ?? ''}
											className="h-10 w-10 rounded border border-border/50 object-contain"
											loading="lazy"
										/>
									)}
								</TableCell>
								<TableCell className="font-semibold">{req.shipTypeName ?? '—'}</TableCell>
								<TableCell className="text-sm">
									<div>{req.characterName}</div>
									{req.corporationName && req.corporationName !== 'Unknown' && (
										<div className="text-xs text-muted-foreground">{req.corporationName}</div>
									)}
								</TableCell>
								<TableCell className="text-right font-mono text-sm tabular-nums">
									{formatISK(req.approvedAmount ?? req.srpEquipmentValue ?? req.shipValue)}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{req.solarSystemName ?? '—'}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{req.lossDate
										? new Date(req.lossDate).toLocaleString(undefined, {
												timeZone: 'UTC',
												year: 'numeric',
												month: 'long',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit',
												hour12: false,
											}) + ' EVE Time'
										: '—'}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{formatRelativeTime(req.createdAt)}
								</TableCell>
								<TableCell>
									<RequestStatusBadge status={req.requestStatus as any} />
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{data && data.total > requests.length && (
				<p className="mt-2 text-center text-sm text-muted-foreground">
					Showing {requests.length} of {data.total}
				</p>
			)}
		</div>
	)
}
