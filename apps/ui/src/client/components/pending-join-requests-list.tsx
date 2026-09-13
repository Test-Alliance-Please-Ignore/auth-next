import { Check, X } from 'lucide-react'
import { useState } from 'react'

import { useApproveJoinRequest, useJoinRequests, useRejectJoinRequest } from '@/hooks/useGroups'
import { formatDate, formatNumber, useAppTranslation } from '@/i18n'

import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

interface PendingJoinRequestsListProps {
	groupId: string
}

export function PendingJoinRequestsList({ groupId }: PendingJoinRequestsListProps) {
	const { t } = useAppTranslation()
	const { data: requests, isLoading, error } = useJoinRequests(groupId)
	const approveRequest = useApproveJoinRequest()
	const rejectRequest = useRejectJoinRequest()
	const [processingId, setProcessingId] = useState<string | null>(null)
	const [errorMessage, setErrorMessage] = useState<{
		action: 'approve' | 'reject'
		error: unknown
	} | null>(null)

	const handleApprove = async (requestId: string) => {
		setProcessingId(requestId)
		setErrorMessage(null)
		try {
			await approveRequest.mutateAsync(requestId)
		} catch (error) {
			setErrorMessage({ action: 'approve', error })
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
			setErrorMessage({ action: 'reject', error })
		} finally {
			setProcessingId(null)
		}
	}

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t('groupDetail.joinRequests.title')}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">{t('groupDetail.joinRequests.loading')}</p>
				</CardContent>
			</Card>
		)
	}

	if (error) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t('groupDetail.joinRequests.title')}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-destructive">{t('groupDetail.joinRequests.loadFailed')}</p>
				</CardContent>
			</Card>
		)
	}

	// Filter to only show pending requests
	const pendingRequests = requests?.filter((req) => req.status === 'pending') || []

	if (pendingRequests.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t('groupDetail.joinRequests.title')}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">{t('groupDetail.joinRequests.empty')}</p>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>{t('groupDetail.joinRequests.title')}</CardTitle>
					<Badge variant="secondary">{formatNumber(pendingRequests.length)}</Badge>
				</div>
				<CardDescription>{t('groupDetail.joinRequests.description')}</CardDescription>
			</CardHeader>
			<CardContent>
				{errorMessage && (
					<div className="rounded-md border border-destructive bg-destructive/10 p-3 mb-4">
						<p className="text-sm text-destructive">
							{t(`groupDetail.joinRequests.${errorMessage.action}Failed`, {
								message:
									errorMessage.error instanceof Error
										? errorMessage.error.message
										: t('groupDetail.unknownError'),
							})}
						</p>
					</div>
				)}

				<div className="space-y-2">
					{pendingRequests.map((request) => (
						<div
							key={request.id}
							className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/20"
						>
							<div className="flex items-start justify-between gap-3">
								<div className="flex-1">
									<div className="font-medium text-sm">
										{request.userMainCharacterName ||
											request.userName ||
											t('groupDetail.joinRequests.user', { id: request.userId })}
									</div>
									{request.reason && (
										<div className="text-sm text-muted-foreground mt-1 italic">
											<q>{request.reason}</q>
										</div>
									)}
									<div className="text-xs text-muted-foreground mt-1">
										{t('groupDetail.joinRequests.requested', {
											date: formatDate(request.createdAt),
										})}
									</div>
								</div>
								<div className="flex gap-2">
									<Button
										variant="confirm"
										size="sm"
										disabled={processingId === request.id}
										loading={processingId === request.id && approveRequest.isPending}
										loadingText={t('groupDetail.joinRequests.approving')}
										onClick={() => handleApprove(request.id)}
										showIcon={false}
									>
										<Check className="h-4 w-4 mr-1" />
										{t('groupDetail.joinRequests.approve')}
									</Button>
									<Button
										variant="destructive"
										size="sm"
										disabled={processingId === request.id}
										loading={processingId === request.id && rejectRequest.isPending}
										loadingText={t('groupDetail.joinRequests.rejecting')}
										onClick={() => handleReject(request.id)}
										showIcon={false}
									>
										<X className="h-4 w-4 mr-1" />
										{t('groupDetail.joinRequests.reject')}
									</Button>
								</div>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	)
}
