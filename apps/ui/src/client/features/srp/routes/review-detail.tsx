import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { characterPortraitUrl, corporationLogoUrl } from '@/lib/eve-images'

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

	const canReview =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')
	const isSrpStaff =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')

	if (!isSrpStaff) return <Navigate to="/srp" replace />
	if (!id) return <Navigate to="/srp/review" replace />

	const { data: request, isLoading, error } = useRequest(id)
	const canSeeInternal = isSrpStaff
	const { data: comments = [], refetch: refetchComments } = useRequestComments(id, canSeeInternal)
	const updateState = useUpdateReviewState()
	const [showRevertConfirm, setShowRevertConfirm] = useState(false)

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
						<span className="inline-flex items-center gap-2">
							<img
								src={characterPortraitUrl(request.characterId, 32)}
								alt={request.characterName}
								className="h-5 w-5 rounded-full border border-border/50 object-cover"
								loading="lazy"
							/>
							<span className="font-semibold">{request.characterName}</span>
						</span>
						<CharacterRoleBadge
							role={getRequestCharacterRole(request)}
							mainCharacterName={request.mainCharacterName}
							mainCharacterId={request.mainCharacterId}
						/>
						<span>·</span>
						<span className="inline-flex items-center gap-2">
							{request.corporationId ? (
								<img
									src={corporationLogoUrl(request.corporationId, 32)}
									alt={request.corporationName}
									className="h-5 w-5 rounded object-cover"
									loading="lazy"
								/>
							) : null}
							<span className="font-semibold">{request.corporationName}</span>
						</span>
						{request.solarSystemName ? (
							<span>
								· {request.solarSystemName}
								{request.solarSystemRegionName ? ` (${request.solarSystemRegionName})` : ''}
							</span>
						) : null}
						<span>·</span>
						<EveTimeDisplay dateStr={request.lossDate} />
					</span>
				}
				action={
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" asChild>
							<a
								href={getKillmailUrl(request.id)}
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

			{/* Review form (shown for reviewers/admins and non-paid states) */}
			{!isPaid && canReview && (
				<ReviewRequestForm
					request={request}
					onSuccess={() => navigate('/srp/review')}
					rightAppend={
						<>
							<Card className="p-6">
								<h3 className="mb-4 font-semibold">Comments</h3>
								<CommentForm
									requestId={id}
									canAddInternal={canSeeInternal}
									onSuccess={refetchComments}
								/>
								<div className="my-4 border-t border-border/40" />
								<CommentsList
									comments={comments}
									requestId={id}
									canAddInternal={canSeeInternal}
									initialContext={
										request.contextText
											? {
													content: request.contextText,
													authorCharacterName: request.characterName,
													authorCharacterId: request.characterId,
													authorCharacterRole: getRequestCharacterRole(request),
													authorMainCharacterName: request.mainCharacterName,
													authorMainCharacterId: request.mainCharacterId,
													createdAt: request.createdAt,
												}
											: undefined
									}
									onCommentAdded={refetchComments}
								/>
							</Card>

							{request.history && request.history.length > 0 && (
								<Card className="p-6">
									<h3 className="mb-4 font-semibold">History</h3>
									<RequestHistory history={request.history} />
								</Card>
							)}
						</>
					}
				/>
			)}

			{/* Read-only details + comments + history when review actions are unavailable */}
			{(isPaid || !canReview) && (
				<div className="grid gap-6 lg:grid-cols-3">
					<div className="space-y-6 lg:col-span-2">
						<Card className="p-6">
							<h3 className="mb-4 font-semibold">Comments</h3>
							<CommentsList
								comments={comments}
								requestId={id}
								canAddInternal={canSeeInternal}
								initialContext={
									request.contextText
										? {
												content: request.contextText,
												authorCharacterName: request.characterName,
												authorCharacterId: request.characterId,
												authorCharacterRole: getRequestCharacterRole(request),
												authorMainCharacterName: request.mainCharacterName,
												authorMainCharacterId: request.mainCharacterId,
												createdAt: request.createdAt,
											}
										: undefined
								}
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
								<RequestHistory history={request.history} />
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
									<div className="inline-flex items-center gap-2 font-semibold">
										<img
											src={characterPortraitUrl(request.characterId, 32)}
											alt={request.characterName}
											className="h-5 w-5 rounded-full border border-border/50 object-cover"
											loading="lazy"
										/>
										<span>{request.characterName}</span>
										<CharacterRoleBadge
											role={getRequestCharacterRole(request)}
											mainCharacterName={request.mainCharacterName}
											mainCharacterId={request.mainCharacterId}
										/>
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">Corporation</div>
									<div className="inline-flex items-center gap-2 font-semibold">
										{request.corporationId ? (
											<img
												src={corporationLogoUrl(request.corporationId, 32)}
												alt={request.corporationName}
												className="h-5 w-5 rounded object-cover"
												loading="lazy"
											/>
										) : null}
										<span>{request.corporationName}</span>
									</div>
								</div>
								<div>
									<div className="text-muted-foreground">System</div>
									<div className="font-medium">{request.solarSystemName ?? '—'}</div>
									{request.solarSystemRegionName ? (
										<div className="text-xs text-muted-foreground">
											{request.solarSystemRegionName}
										</div>
									) : null}
								</div>
								<div>
									<div className="text-muted-foreground">Loss Date</div>
									<EveTimeDisplay dateStr={request.lossDate} className="font-medium" />
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

						{canReview && (
							<Card className="p-6">
								<div className="space-y-3">
									<div className="flex gap-2">
										{showRevertConfirm && (
											<Button
												variant="secondary"
												onClick={() => setShowRevertConfirm(false)}
												disabled={updateState.isPending}
											>
												Back
											</Button>
										)}
										<Button
											variant="primary"
											className="flex-1"
											loading={updateState.isPending}
											onClick={() => {
												if (!showRevertConfirm) {
													setShowRevertConfirm(true)
													return
												}
												void updateState
													.mutateAsync({ id, newState: 'pending' })
													.then(() => navigate('/srp/review'))
											}}
										>
											{showRevertConfirm ? 'Confirm Revert to Pending' : 'Revert to Pending'}
										</Button>
									</div>
									{showRevertConfirm && (
										<div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600">
											Confirm state change: <strong>pending</strong> for {request.shipTypeName}?
										</div>
									)}
								</div>
							</Card>
						)}
					</div>
				</div>
			)}
		</Container>
	)
}
