import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import { formatFullDate, formatISK } from '../utils'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { SRPHistoryResponse } from '../types'

interface RequestHistoryProps {
	history: SRPHistoryResponse[]
	className?: string
	showFinancialAudit?: boolean
}

export function RequestHistory({ history, className, showFinancialAudit = false }: RequestHistoryProps) {
	if (history.length === 0) {
		return (
			<Card className={cn('p-6', className)}>
				<p className="text-sm text-muted-foreground">No history available.</p>
			</Card>
		)
	}

	return (
		<Card className={cn('p-6', className)}>
			<h3 className="mb-4 font-semibold">Request Timeline</h3>
			<div className="relative space-y-6 before:absolute before:left-[7px] before:top-2 before:h-[calc(100%-1rem)] before:w-[2px] before:bg-border">
				{history.map((entry) => (
					<div key={entry.id} className="relative pl-8">
						{/* Timeline dot */}
						<div
							className={cn(
								'absolute left-0 top-1.5 h-4 w-4 rounded-full border-2 border-background',
								getActionColor(entry.action)
							)}
						/>

						{/* Content */}
						<div className="space-y-1">
							<div className="flex items-center gap-2">
								<span className="text-sm font-medium">{getActionLabel(entry.action)}</span>
								{entry.newRequestStatus && <RequestStatusBadge status={entry.newRequestStatus} />}
							</div>
							<div className="text-xs text-muted-foreground">
								{entry.actorCharacterName} · {formatFullDate(entry.timestamp)}
							</div>
							{entry.metadata && Object.keys(entry.metadata).length > 0 && (
								<div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
									{entry.metadata.rejectionReason ? (
										<div>
											<span className="font-medium">Reason: </span>
											{String(entry.metadata.rejectionReason)}
										</div>
									) : null}
									{entry.metadata.notes ? (
										<div>
											<span className="font-medium">Notes: </span>
											{String(entry.metadata.notes)}
										</div>
									) : null}
								</div>
							)}
							{showFinancialAudit && entry.previousApprovedAmount ? (
								<div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
									<span className="font-medium">Previous Approved Amount: </span>
									<span className="tabular-nums">{formatISK(entry.previousApprovedAmount)}</span>
								</div>
							) : null}
						</div>
					</div>
				))}
			</div>
		</Card>
	)
}

function getActionColor(action: string): string {
	if (action.includes('approved')) return 'bg-green-500'
	if (action.includes('rejected')) return 'bg-red-500'
	if (action.includes('payment')) return 'bg-primary'
	if (action.includes('created')) return 'bg-blue-500'
	return 'bg-muted-foreground'
}

function getActionLabel(action: string): string {
	const labels: Record<string, string> = {
		request_created: 'Request Created',
		request_approved: 'Approved',
		request_partially_approved: 'Partially Approved',
		request_rejected: 'Rejected',
		payment_submitted: 'Payment Pending',
		payment_completed: 'Payment Completed',
		partial_payment_completed: 'Partial Payment',
	}
	return labels[action] || action
}
