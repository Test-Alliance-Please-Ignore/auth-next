import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { roundToMillion } from '@repo/srp'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { formatNumber, useAppTranslation } from '@/i18n'
import { characterPortraitUrl, corporationLogoUrl } from '@/lib/eve-images'
import toast from '@/lib/toast'

import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import { CommentForm } from '../components/CommentForm'
import { CommentsList } from '../components/CommentsList'
import { RequestHistory } from '../components/RequestHistory'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { ReviewRequestForm } from '../components/ReviewRequestForm'
import { SRPFeedback } from '../components/SRPFeedback'
import { SRPRequestDetailSkeleton } from '../components/SRPRequestDetailSkeleton'
import { useRequest, useRequestComments, useUpdateReviewState, useVerifyPaid } from '../hooks'
import { formatISK, getKillmailUrl, getRequestCharacterRole } from '../utils'

function formatAppliedModifierValue(modifier: {
	modifierType: 'deduction' | 'bonus'
	mode: 'percentage' | 'value'
	amount: number
	computedAmountISK: string
}): string {
	const sign = modifier.modifierType === 'deduction' ? '−' : '+'
	const computedAmount = Number.parseFloat(modifier.computedAmountISK)
	const roundedToNearestMillion = Number.isFinite(computedAmount)
		? roundToMillion(String(Math.round(computedAmount)))
		: '0'

	if (modifier.mode === 'value') {
		return `${sign}${formatISK(roundedToNearestMillion)}`
	}

	return `${sign}${formatNumber(modifier.amount / 100, { style: 'percent', maximumFractionDigits: 2 })} (${formatISK(roundedToNearestMillion)})`
}

export default function ReviewRequestDetail() {
	const { t } = useAppTranslation()
	const { id } = useParams<{ id: string }>()
	const { hasPermission, isAdmin } = useUserPermissions()
	const navigate = useNavigate()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const canReview =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')
	const canOpenHrUserProfile = isAdmin || hasPermission('urn:hr:auditor')
	const isSrpStaff =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')

	if (!isSrpStaff) return <Navigate to="/srp" replace />
	if (!id) return <Navigate to="/srp/review" replace />

	const { data: request, isLoading, error } = useRequest(id)
	usePageTitle(
		request ? t('srp.reviewDetail.titleFor', { id: request.id }) : t('srp.reviewDetail.pageTitle')
	)
	const canSeeInternal = isSrpStaff
	const { data: comments = [], refetch: refetchComments } = useRequestComments(id, canSeeInternal)
	const updateState = useUpdateReviewState()
	const verifyPaid = useVerifyPaid()
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
				<PageHeader title={t('srp.detail.notFoundTitle')} />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">
						{error instanceof Error ? error.message : t('srp.detail.notFound')}
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp/review">{t('srp.reviewDetail.backQueue')}</Link>
					</Button>
				</div>
			</Container>
		)
	}

	const isPaid = request.requestStatus === 'paid' || request.requestStatus === 'payment_pending'
	const canManuallyVerifyPaid =
		hasPermission('urn:srp:manager') && request.requestStatus === 'payment_pending'
	const appliedModifiers = request.appliedModifiers ?? []

	const handleManualVerifyPaid = async () => {
		requestConfirmation({
			title: (t) => t('srp.reviewDetail.verifyTitle'),
			description: (t) => t('srp.reviewDetail.verifyDescription', { id: request.id }),
			confirmLabel: (t) => t('srp.reviewDetail.verify'),
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await verifyPaid.mutateAsync({ id: request.id })
					toast.success(<SRPFeedback messageKey="srp.reviewDetail.verified" />)
				} catch (err: any) {
					toast.error(<SRPFeedback messageKey="srp.reviewDetail.verifyFailed" />, {
						description: err?.message ?? t('srp.common.unknownError'),
					})
				}
			},
		})
	}

	return (
		<>
			<Container>
				<PageHeader
					title={t('srp.reviewDetail.heading', {
						ship: request.shipTypeName ?? t('srp.common.ship'),
						id: request.id,
					})}
					description={
						<span className="inline-flex items-center gap-2 flex-wrap">
							<span className="inline-flex items-center gap-2">
								<img
									src={characterPortraitUrl(request.characterId, 32)}
									alt={request.characterName}
									className="h-5 w-5 rounded-full border border-border/50 object-cover"
									loading="lazy"
								/>
								{canOpenHrUserProfile ? (
									<Link
										to={`/hr/users/${request.userId}`}
										className="font-semibold text-primary hover:underline"
									>
										{request.characterName}
									</Link>
								) : (
									<span className="font-semibold">{request.characterName}</span>
								)}
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
								<a href={getKillmailUrl(request.id)} target="_blank" rel="noopener noreferrer">
									{t('srp.common.zkill')}
								</a>
							</Button>
							<Button variant="ghost" size="sm" asChild>
								<Link to="/srp/review">{t('srp.reviewDetail.back')}</Link>
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
									<h3 className="mb-4 font-semibold">{t('srp.common.comments')}</h3>
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
										<h3 className="mb-4 font-semibold">{t('srp.common.history')}</h3>
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
								<h3 className="mb-4 font-semibold">{t('srp.common.comments')}</h3>
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
									<h3 className="mb-4 font-semibold">{t('srp.common.history')}</h3>
									<RequestHistory history={request.history} />
								</Card>
							)}
						</div>

						<div className="space-y-6">
							<Card className="p-6">
								<h3 className="mb-4 font-semibold">{t('srp.detail.lossDetails')}</h3>
								<div className="space-y-3 text-sm">
									<div>
										<div className="text-muted-foreground">{t('srp.common.ship')}</div>
										<div className="font-medium">{request.shipTypeName}</div>
									</div>
									<div>
										<div className="text-muted-foreground">{t('srp.common.character')}</div>
										<div className="inline-flex items-center gap-2 font-semibold">
											<img
												src={characterPortraitUrl(request.characterId, 32)}
												alt={request.characterName}
												className="h-5 w-5 rounded-full border border-border/50 object-cover"
												loading="lazy"
											/>
											{canOpenHrUserProfile ? (
												<Link
													to={`/hr/users/${request.userId}`}
													className="text-primary hover:underline"
												>
													{request.characterName}
												</Link>
											) : (
												<span>{request.characterName}</span>
											)}
											<CharacterRoleBadge
												role={getRequestCharacterRole(request)}
												mainCharacterName={request.mainCharacterName}
												mainCharacterId={request.mainCharacterId}
											/>
										</div>
									</div>
									<div>
										<div className="text-muted-foreground">{t('srp.common.corporation')}</div>
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
										<div className="text-muted-foreground">{t('srp.common.system')}</div>
										<div className="font-medium">{request.solarSystemName ?? '—'}</div>
										{request.solarSystemRegionName ? (
											<div className="text-xs text-muted-foreground">
												{request.solarSystemRegionName}
											</div>
										) : null}
									</div>
									<div>
										<div className="text-muted-foreground">{t('srp.common.lossDate')}</div>
										<EveTimeDisplay dateStr={request.lossDate} className="font-medium" />
									</div>
									{request.approvedAmount && (
										<div>
											<div className="text-muted-foreground">{t('srp.common.paidAmount')}</div>
											<div className="font-medium tabular-nums text-success">
												{formatISK(request.approvedAmount)}
											</div>
										</div>
									)}
								</div>
							</Card>
							<Card className="p-6">
								<h3 className="mb-4 font-semibold">{t('srp.detail.adjustments')}</h3>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<div className="text-sm text-muted-foreground">
											{t('srp.detail.coveragePolicy')}
										</div>
										<div className="font-medium">
											{request.appliedModifierPolicyName ?? t('srp.common.none')}
										</div>
									</div>
									<div>
										<div className="text-sm text-muted-foreground">{t('srp.review.capPolicy')}</div>
										<div className="font-medium">
											{request.appliedCapPolicyName ?? t('srp.common.none')}
										</div>
									</div>
								</div>

								<div className="mt-4">
									<div className="text-sm text-muted-foreground">{t('srp.detail.modifiers')}</div>
									{appliedModifiers.length > 0 ? (
										<ul className="mt-2 space-y-1 text-sm">
											{appliedModifiers.map(
												(modifier: {
													id: string
													modifierType: 'deduction' | 'bonus'
													mode: 'percentage' | 'value'
													amount: number
													reason: string
													computedAmountISK: string
												}) => (
													<li
														key={modifier.id}
														className={
															modifier.modifierType === 'deduction'
																? 'flex items-center gap-2 text-destructive'
																: 'flex items-center gap-2 text-green-600'
														}
													>
														<Badge
															variant={
																modifier.modifierType === 'deduction' ? 'destructive' : 'success'
															}
														>
															{modifier.modifierType === 'deduction'
																? t('srp.common.deduction')
																: t('srp.common.bonus')}
														</Badge>
														<span className="font-semibold">
															{formatAppliedModifierValue(modifier)}
														</span>
														<span className="text-foreground">: {modifier.reason}</span>
													</li>
												)
											)}
										</ul>
									) : (
										<div className="mt-1 text-sm font-medium">{t('srp.common.none')}</div>
									)}
								</div>
							</Card>

							{canReview && (
								<Card className="p-6">
									<div className="space-y-3">
										<div className="flex flex-col gap-2">
											{showRevertConfirm && (
												<Button
													variant="secondary"
													onClick={() => setShowRevertConfirm(false)}
													disabled={updateState.isPending}
												>
													{t('srp.common.back')}
												</Button>
											)}
											<Button
												variant="primary"
												size="sm"
												className="w-full"
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
												{showRevertConfirm
													? t('srp.reviewDetail.confirmRevert')
													: t('srp.reviewDetail.revert')}
											</Button>
											{canManuallyVerifyPaid && (
												<Button
													variant="secondary"
													size="sm"
													className="w-full"
													onClick={() => void handleManualVerifyPaid()}
													disabled={verifyPaid.isPending || updateState.isPending}
												>
													{t('srp.reviewDetail.verifyTitle')}
												</Button>
											)}
										</div>
										{showRevertConfirm && (
											<div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-600">
												{t('srp.reviewDetail.revertDescription', {
													status: t('srp.status.pending'),
													ship: request.shipTypeName,
												})}
											</div>
										)}
									</div>
								</Card>
							)}
						</div>
					</div>
				)}
			</Container>
			{confirmationDialog}
		</>
	)
}
