import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { CommentForm } from '../components/CommentForm'
import { CommentsList } from '../components/CommentsList'
import { RequestHistory } from '../components/RequestHistory'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { ReviewRequestForm } from '../components/ReviewRequestForm'
import { useRequest, useRequestComments } from '../hooks'
import { formatFullDate, formatISK, getKillmailUrl } from '../utils'

export default function ReviewRequestDetail() {
	const { id } = useParams<{ id: string }>()
	const { hasPermission, isAdmin } = useUserPermissions()
	const navigate = useNavigate()

	const isReviewer = isAdmin || hasPermission('urn:srp:reviewer')

	if (!isReviewer) return <Navigate to="/srp" replace />
	if (!id) return <Navigate to="/srp/review" replace />

	const { data: request, isLoading, error } = useRequest(id)
	const canSeeInternal = isReviewer || hasPermission('urn:srp:payer')
	const { data: comments = [], refetch: refetchComments } = useRequestComments(id, canSeeInternal)

	if (isLoading) {
		return (
			<Container>
				<div className="flex min-h-[400px] items-center justify-center">
					<div className="text-center">
						<div className="mb-2 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
						<p className="text-sm text-muted-foreground">Loading request...</p>
					</div>
				</div>
			</Container>
		)
	}

	if (error || !request) {
		return (
			<Container>
				<PageHeader title="Request Not Found" />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">
						{error instanceof Error ? error.message : 'Request not found'}
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp/review">Back to Review Queue</Link>
					</Button>
				</div>
			</Container>
		)
	}

	const isPaid = request.requestStatus === 'paid'

	return (
		<Container>
			<PageHeader
				title={`Review: ${request.shipTypeName ?? 'Ship'}`}
				description={`${request.characterName} · ${request.corporationName} · ${formatFullDate(request.lossDate)}`}
				action={
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" asChild>
							<a
								href={getKillmailUrl(request.killmailId)}
								target="_blank"
								rel="noopener noreferrer"
							>
								View on zKillboard
							</a>
						</Button>
						<Button variant="secondary" size="sm" asChild>
							<Link to="/srp/review">← Back to Queue</Link>
						</Button>
					</div>
				}
			/>

			<div className="space-y-2 mb-6 flex items-center gap-3">
				<RequestStatusBadge status={request.requestStatus as any} />
				{request.approvedAmount && (
					<span className="text-sm font-mono font-semibold text-primary">
						{formatISK(request.approvedAmount)}
					</span>
				)}
				{request.srpEquipmentValue && (
					<span className="text-xs text-muted-foreground">
						Equipment value: {formatISK(request.srpEquipmentValue)}
					</span>
				)}
			</div>

			{/* Review form (shown for non-paid, reviewable states) */}
			{!isPaid && (
				<div className="mb-8">
					<ReviewRequestForm request={request} onSuccess={() => navigate('/srp/review')} />
				</div>
			)}

			{/* History + comments below */}
			<div className="grid gap-6 lg:grid-cols-2">
				{request.history && request.history.length > 0 && (
					<Card className="p-6">
						<h3 className="mb-4 font-semibold">History</h3>
						<RequestHistory history={request.history} />
					</Card>
				)}

				<Card className="p-6">
					<h3 className="mb-4 font-semibold">Comments</h3>
					<CommentsList
						comments={comments}
						requestId={id}
						canAddInternal={canSeeInternal}
						onCommentAdded={refetchComments}
					/>
					{!isPaid && (
						<div className="mt-4">
							<CommentForm
								requestId={id}
								canAddInternal={canSeeInternal}
								onSuccess={refetchComments}
							/>
						</div>
					)}
				</Card>
			</div>
		</Container>
	)
}
