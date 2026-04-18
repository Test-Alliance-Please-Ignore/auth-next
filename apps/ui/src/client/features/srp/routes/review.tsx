import { Navigate, useNavigate } from 'react-router-dom'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
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

			<Tabs defaultValue="pending" className="mt-section">
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
		<div className="mt-4 overflow-hidden rounded-lg border-2 border-primary/30 bg-card shadow-lg">
			<table className="w-full">
				<thead>
					<tr className="border-b-2 border-primary/40 bg-primary/30">
						<th className="w-14 p-3" />
						<th className="p-3 text-left text-sm font-bold">Ship</th>
						<th className="p-3 text-left text-sm font-bold">Pilot</th>
						<th className="p-3 text-right text-sm font-bold">Value</th>
						<th className="p-3 text-left text-sm font-bold">Lost</th>
						<th className="p-3 text-left text-sm font-bold">Submitted</th>
						<th className="p-3 text-left text-sm font-bold">Status</th>
					</tr>
				</thead>
				<tbody>
					{requests.map((req, idx) => (
						<tr
							key={req.id}
							className="cursor-pointer border-b border-border/50 transition-colors hover:bg-primary/15"
							style={{ background: idx % 2 === 0 ? 'hsl(var(--card))' : 'hsl(var(--muted) / 0.5)' }}
							onClick={() => navigate(`/srp/review/${req.id}`)}
						>
							<td className="p-2">
								{req.shipTypeId && (
									<img
										src={typeIconUrl(req.shipTypeId, 32)}
										alt={req.shipTypeName ?? ''}
										className="h-10 w-10 rounded border border-border/50 object-contain"
										loading="lazy"
									/>
								)}
							</td>
							<td className="p-3 font-semibold">{req.shipTypeName ?? '—'}</td>
							<td className="p-3 text-sm">
								<div>{req.characterName}</div>
								{req.corporationName && (
									<div className="text-xs text-muted-foreground">{req.corporationName}</div>
								)}
							</td>
							<td className="p-3 text-right font-mono text-sm tabular-nums">
								{formatISK(req.srpEquipmentValue ?? req.shipValue)}
							</td>
							<td className="p-3 text-sm text-muted-foreground">
								{formatRelativeTime(req.lossDate)}
							</td>
							<td className="p-3 text-sm text-muted-foreground">
								{formatRelativeTime(req.createdAt)}
							</td>
							<td className="p-3">
								<RequestStatusBadge status={req.requestStatus as any} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{data && data.total > requests.length && (
				<div className="border-t border-border/30 p-3 text-center text-sm text-muted-foreground">
					Showing {requests.length} of {data.total}
				</div>
			)}
		</div>
	)
}
