import { Check, X } from 'lucide-react'
import { useState } from 'react'

import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from '@/hooks/useGroups'

import { Badge } from './ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { ConfirmButton } from './ui/confirm-button'
import { DestructiveButton } from './ui/destructive-button'

interface PendingJoinRequestsListProps {
	groupId: string
}

export function PendingJoinRequestsList({ groupId }: PendingJoinRequestsListProps) {
	const { data: requests, isLoading, error } = useJoinRequests(groupId)
	const approveRequest = useApproveJoinRequest()
	const rejectRequest = useRejectJoinRequest()
	const [processingId, setProcessingId] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const handleApprove = async (requestId: string) => {
		setProcessingId(requestId)
		setErrorMessage(null)
		try {
			await approveRequest.mutateAsync(requestId)
		} catch (error) {
			setErrorMessage(
				`Failed to approve: ${error instanceof Error ? error.message : 'Unknown error'}`
			)
		} finally {
			setProcessingId(null)
		}
	}

	const handleReject = async (requestId: string) => {
		setProcessingId(requestId)
		setErrorMessage(null)
		try {
			await rejectRequest.mutateAsync(requestId)
		} catch (error) {
			setErrorMessage(
				`Failed to reject: ${error instanceof Error ? error.message : 'Unknown error'}`
			)
		} finally {
			setProcessingId(null)
		}
	}

	if (isLoading) {
		return (
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Pending Join Requests</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">Loading join requests...</p>
				</CardContent>
			</Card>
		)
	}

	if (error) {
		return (
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Pending Join Requests</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-destructive">Failed to load join requests</p>
				</CardContent>
			</Card>
		)
	}

	// Filter to only show pending requests
	const pendingRequests = requests?.filter((req) => req.status === 'pending') || []

	if (pendingRequests.length === 0) {
		return (
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Pending Join Requests</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">No pending join requests</p>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card variant="interactive">
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>Pending Join Requests</CardTitle>
					<Badge variant="secondary">{pendingRequests.length}</Badge>
				</div>
				<CardDescription>Review and respond to membership requests</CardDescription>
			</CardHeader>
			<CardContent>
				{errorMessage && (
					<div className="rounded-md border border-destructive bg-destructive/10 p-3 mb-4">
						<p className="text-sm text-destructive">{errorMessage}</p>
					</div>
				)}

				<div className="space-y-2">
					{pendingRequests.map((request) => (
						<div
							key={request.id}
							className="border border-border rounded-lg p-3 hover:bg-muted/50 transition-colors"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="flex-1">
									<div className="font-medium text-sm">
										{request.userMainCharacterName || request.userName || `User ${request.userId}`}
									</div>
									{request.reason && (
										<div className="text-sm text-muted-foreground mt-1 italic">
											"{request.reason}"
										</div>
									)}
									<div className="text-xs text-muted-foreground mt-1">
										Requested: {new Date(request.createdAt).toLocaleDateString()}
									</div>
								</div>
								<div className="flex gap-2">
									<ConfirmButton
										size="sm"
										disabled={processingId === request.id}
										loading={processingId === request.id && approveRequest.isPending}
										loadingText="Approving..."
										onClick={() => handleApprove(request.id)}
										showIcon={false}
									>
										<Check className="h-4 w-4 mr-1" />
										Approve
									</ConfirmButton>
									<DestructiveButton
										size="sm"
										disabled={processingId === request.id}
										loading={processingId === request.id && rejectRequest.isPending}
										loadingText="Rejecting..."
										onClick={() => handleReject(request.id)}
										showIcon={false}
									>
										<X className="h-4 w-4 mr-1" />
										Reject
									</DestructiveButton>
								</div>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}
