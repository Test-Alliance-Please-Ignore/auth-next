import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

import { formatISK, formatRelativeTime } from '../utils'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { SRPRequestResponse } from '../types'

interface RequestTableProps {
	requests: SRPRequestResponse[]
	isLoading?: boolean
	showPagination?: boolean
}

export function RequestTable({ requests, isLoading, showPagination }: RequestTableProps) {
	if (isLoading) {
		return (
			<div className="space-y-4">
				{[...Array(5)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
				))}
			</div>
		)
	}

	if (requests.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-8 text-center">
				<p className="text-sm text-muted-foreground">No requests found.</p>
			</div>
		)
	}

	return (
		<div className="overflow-hidden rounded-lg border-2 border-primary/20 shadow-lg">
			<Table>
				<TableHeader>
					<TableRow className="border-b-2 border-primary/30 bg-primary/10 hover:bg-primary/10">
						<TableHead className="font-bold text-foreground">Ship</TableHead>
						<TableHead className="font-bold text-foreground">Character</TableHead>
						<TableHead className="font-bold text-foreground">Date</TableHead>
						<TableHead className="text-right font-bold text-foreground">Requested</TableHead>
						<TableHead className="text-right font-bold text-foreground">Approved</TableHead>
						<TableHead className="font-bold text-foreground">Status</TableHead>
						<TableHead className="font-bold text-foreground">Payment</TableHead>
						<TableHead className="text-right font-bold text-foreground">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{requests.map((request, index) => (
						<TableRow
							key={request.id}
							className="border-b border-border/40 transition-colors hover:bg-primary/5"
							style={{
								background: index % 2 === 0 ? 'transparent' : 'hsl(var(--muted) / 0.15)',
							}}
						>
							<TableCell className="font-semibold">{request.shipTypeName}</TableCell>
							<TableCell className="text-sm font-medium">{request.characterName}</TableCell>
							<TableCell className="text-sm text-muted-foreground">
								{formatRelativeTime(request.createdAt)}
							</TableCell>
							<TableCell className="text-right font-mono text-sm tabular-nums">
								{request.requestedAmount ? formatISK(request.requestedAmount) : '—'}
							</TableCell>
							<TableCell className="text-right font-mono text-sm tabular-nums">
								{request.approvedAmount ? formatISK(request.approvedAmount) : '—'}
							</TableCell>
							<TableCell>
								<RequestStatusBadge status={request.requestStatus} />
							</TableCell>
							<TableCell>
								<PaymentStatusBadge status={request.paymentStatus} />
							</TableCell>
							<TableCell className="text-right">
								<Button variant="outline" size="sm" asChild>
									<Link to={`/srp/request/${request.id}`}>View</Link>
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}
