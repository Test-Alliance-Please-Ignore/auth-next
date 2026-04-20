import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { CommentForm } from '../components/CommentForm'
import { CommentsList } from '../components/CommentsList'
import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import { RequestHistory } from '../components/RequestHistory'
import { SRPRequestDetailSkeleton } from '../components/SRPRequestDetailSkeleton'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { ReviewRequestForm } from '../components/ReviewRequestForm'
import { useRequest, useRequestComments, useUpdateReviewState } from '../hooks'
import { formatISK, getKillmailUrl, getRequestCharacterRole } from '../utils'

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
	const updateState = useUpdateReviewState()

	if (isLoading) {
		return (
			<Container>
				<SRPRequestDetailSkeleton mode="review" />
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

	const isPaid = request.requestStatus === 'paid' || request.requestStatus === 'payment_pending'

	return (
		<Container>
			<PageHeader
				title={`Review: ${request.shipTypeName ?? 'Ship'}`}
				description={
					<span className="inline-flex items-center gap-2 flex-wrap">
						<span>{request.characterName}</span>
						<CharacterRoleBadge role={getRequestCharacterRole(request)} />
						<span>· {request.corporationName} ·</span>
						<EveTimeDisplay dateStr={request.lossDate} />
					</span>
				}
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
						<Button variant="ghost" size="sm" asChild>
							<Link to="/srp/review">← Back to Queue</Link>
						</Button>
					</div>
				}
			/>

			<div className="mb-6 flex items-center gap-3">
				<RequestStatusBadge status={request.requestStatus as any} />
				{request.approvedAmount && (
					<span className="font-mono font-semibold text-success">
						{formatISK(request.approvedAmount)}
					</span>
				)}
			</div>

			{/* Review form (shown for non-paid, reviewable states) */}
			{!isPaid && (
				<ReviewRequestForm
					request={request}
					onSuccess={() => navigate('/srp/review')}
					commentSlot={
						<Card className="p-4">
							<h4 className="mb-3 text-sm font-semibold">Comment</h4>
							<CommentForm
								requestId={id}
								canAddInternal={canSeeInternal}
								onSuccess={refetchComments}
							/>
						</Card>
					}
					rightAppend={
						<>
							<Card className="p-6">
								<h3 className="mb-4 font-semibold">Comments</h3>
								<CommentsList
									comments={comments}
									requestId={id}
									canAddInternal={canSeeInternal}
									onCommentAdded={refetchComments}
								/>
							</Card>

							{request.history && request.history.length > 0 && (
								<Card className="p-6">
									<h3 className="mb-4 font-semibold">History</h3>
									<RequestHistory history={request.history} showFinancialAudit={canSeeInternal} />
								</Card>
							)}
						</>
					}
				/>
			)}

			{/* Loss details + revert + comments for paid requests (no review form) */}
			{isPaid && (
				<div className="grid gap-6 lg:grid-cols-3">
					<div className="space-y-6 lg:col-span-2">
						<Card className="p-6">
							<h3 className="mb-4 font-semibold">Comments</h3>
							<CommentsList
								comments={comments}
								requestId={id}
								canAddInternal={canSeeInternal}
								onCommentAdded={refetchComments}
							/>
							<div className="mt-4 border-t border-border/40 pt-4">
								<CommentForm
									requestId={id}
									canAddInternal={canSeeInternal}
									onSuccess={refetchComments}
								/>
							</div>
						</Card>

						{request.history && request.history.length > 0 && (
							<Card className="p-6">
								<h3 className="mb-4 font-semibold">History</h3>
								<RequestHistory history={request.history} showFinancialAudit={canSeeInternal} />
							</Card>
						)}
					</div>

					<div className="space-y-6">
						<Card className="p-6">
							<h3 className="mb-4 font-semibold">Loss Details</h3>
							<div className="space-y-3 text-sm">
								<div>
									<div className="text-muted-foreground">Ship</div>
									<div className="font-medium">{request.shipTypeName}</div>
								</div>
								<div>
									<div className="text-muted-foreground">Character</div>
									<div className="inline-flex items-center gap-2 font-medium">
										<span>{request.characterName}</span>
										<CharacterRoleBadge role={getRequestCharacterRole(request)} />
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">Corporation</div>
									<div className="font-medium">{request.corporationName}</div>
								</div>
								<div>
									<div className="text-muted-foreground">Loss Date</div>
									<EveTimeDisplay dateStr={request.lossDate} className="font-medium no-underline" />
								</div>
								{request.approvedAmount && (
									<div>
										<div className="text-muted-foreground">Paid Amount</div>
										<div className="font-medium tabular-nums text-success">
											{formatISK(request.approvedAmount)}
										</div>
									</div>
								)}
							</div>
						</Card>

						<Card className="p-6">
							<Button
								variant="ghost"
								className="w-full"
								loading={updateState.isPending}
								onClick={() =>
									void updateState.mutateAsync({ id, newState: 'pending' }).then(() =>
										navigate('/srp/review')
									)
								}
							>
								Revert to Pending
							</Button>
						</Card>
					</div>
				</div>
			)}
		</Container>
	)
}
