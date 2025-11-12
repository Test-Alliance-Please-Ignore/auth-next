import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { calculateDifference, formatISK, formatRelativeTime, getKillmailUrl } from '../utils'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { SRPRequestResponse } from '../types'

interface RequestCardProps {
	request: SRPRequestResponse
	showActions?: boolean
}

export function RequestCard({ request, showActions = true }: RequestCardProps) {
	const difference = calculateDifference(request.requestedAmount, request.approvedAmount)

	return (
		<Card className="p-4">
			<div className="space-y-3">
				<div className="flex items-start justify-between">
					<div>
						<h3 className="font-semibold">{request.shipTypeName}</h3>
						<p className="text-sm text-muted-foreground">
							{request.characterName} · {formatRelativeTime(request.createdAt)}
						</p>
					</div>
					<div className="flex flex-col items-end gap-1">
						<RequestStatusBadge status={request.requestStatus} />
						<PaymentStatusBadge status={request.paymentStatus} />
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4 text-sm">
					<div>
						<div className="text-muted-foreground">Ship Value</div>
						<div className="font-medium tabular-nums">{formatISK(request.shipValue)} ISK</div>
					</div>
					{request.requestedAmount && (
						<div>
							<div className="text-muted-foreground">Requested</div>
							<div className="font-medium tabular-nums">
								{formatISK(request.requestedAmount)} ISK
							</div>
						</div>
					)}
					{request.approvedAmount && (
						<div>
							<div className="text-muted-foreground">Approved</div>
							<div className="font-medium tabular-nums">
								{formatISK(request.approvedAmount)} ISK
								{difference !== 0 && (
									<span className={difference > 0 ? 'text-green-500' : 'text-red-500'}>
										{' '}
										({difference > 0 ? '+' : ''}
										{formatISK(Math.abs(difference))})
									</span>
								)}
							</div>
						</div>
					)}
				</div>

				{showActions && (
					<div className="flex gap-2">
						<Button variant="outline" size="sm" asChild>
							<Link to={`/srp/request/${request.id}`}>View Details</Link>
						</Button>
						<Button variant="ghost" size="sm" asChild>
							<a
								href={getKillmailUrl(request.killmailId)}
								target="_blank"
								rel="noopener noreferrer"
							>
								Killmail
							</a>
						</Button>
					</div>
				)}
			</div>
		</Card>
	)
}
