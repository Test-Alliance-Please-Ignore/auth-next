import { Check, X } from 'lucide-react'
import { useState } from 'react'

import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from '@/hooks/useGroups'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'

interface PendingJoinRequestsListProps {
	groupId: string
}

export function PendingJoinRequestsList({ groupId }: PendingJoinRequestsListProps) {
	const { data: requests, isLoading, error } = useJoinRequests(groupId)
	const approveRequest = useApproveJoinRequest()
	const rejectRequest = useRejectJoinRequest()
	const [processingId, setProcessingId] = useState<string | null>(null)

	const handleApprove = async (requestId: string) => {
		setProcessingId(requestId)
		try {
			await approveRequest.mutateAsync(requestId)
			alert('Join request approved!')
		} catch (error) {
			alert(`Failed to approve: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setProcessingId(null)
		}
	}

	const handleReject = async (requestId: string) => {
		setProcessingId(requestId)
		try {
			await rejectRequest.mutateAsync(requestId)
			alert('Join request rejected')
		} catch (error) {
			alert(`Failed to reject: ${error instanceof Error ? error.message : 'Unknown error'}`)
		} finally {
			setProcessingId(null)
		}
	}

	if (isLoading) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">Pending Join Requests</h3>
				<div className="text-sm text-gray-500">Loading join requests...</div>
			</Card>
		)
	}

	if (error) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">Pending Join Requests</h3>
				<div className="text-sm text-red-600">Failed to load join requests</div>
			</Card>
		)
	}

	// Filter to only show pending requests
	const pendingRequests = requests?.filter((req) => req.status === 'pending') || []

	if (pendingRequests.length === 0) {
		return (
			<Card className="p-4">
				<h3 className="text-lg font-semibold mb-3">Pending Join Requests</h3>
				<div className="text-sm text-gray-500">No pending join requests</div>
			</Card>
		)
	}

	return (
		<Card className="p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="text-lg font-semibold">Pending Join Requests</h3>
				<Badge variant="secondary">{pendingRequests.length}</Badge>
			</div>

			<div className="space-y-2">
				{pendingRequests.map((request) => (
					<div
						key={request.id}
						className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
					>
						<div className="flex items-start justify-between gap-3">
							<div className="flex-1">
								<div className="font-medium text-sm">
									{request.userMainCharacterName || request.userName || `User ${request.userId}`}
								</div>
								{request.reason && (
									<div className="text-sm text-gray-700 mt-1 italic">"{request.reason}"</div>
								)}
								<div className="text-xs text-gray-500 mt-1">
									Requested: {new Date(request.createdAt).toLocaleDateString()}
								</div>
							</div>
							<div className="flex gap-2">
								<Button
									variant="default"
									size="sm"
									disabled={processingId === request.id || approveRequest.isPending}
									onClick={() => handleApprove(request.id)}
								>
									<Check className="h-4 w-4 mr-1" />
									Approve
								</Button>
								<Button
									variant="destructive"
									size="sm"
									disabled={processingId === request.id || rejectRequest.isPending}
									onClick={() => handleReject(request.id)}
								>
									<X className="h-4 w-4 mr-1" />
									Reject
								</Button>
							</div>
						</div>
					</div>
				))}
			</div>
		</Card>
	)
}
