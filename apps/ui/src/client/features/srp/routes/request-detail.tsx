import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { roundToMillion } from '@repo/srp'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { formatNumber, useAppTranslation } from '@/i18n'

import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import { CommentForm } from '../components/CommentForm'
import { CommentsList } from '../components/CommentsList'
import { RequestHistory } from '../components/RequestHistory'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { SRPRequestDetailSkeleton } from '../components/SRPRequestDetailSkeleton'
import { useCreateRequest, useRequest, useRequestComments, useWithdrawRequest } from '../hooks'
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

export default function RequestDetails() {
	const { t } = useAppTranslation()
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const { data: request, isLoading, error } = useRequest(id)
	const { data: comments = [], refetch: refetchComments } = useRequestComments(id, false)
	const createRequest = useCreateRequest()
	const withdrawRequest = useWithdrawRequest()

	usePageTitle(request ? t('srp.detail.titleFor', { id: request.id }) : t('srp.detail.pageTitle'))

	if (!id) {
		return <Navigate to="/srp" replace />
	}

	if (isLoading) {
		return (
			<Container>
				<SRPRequestDetailSkeleton mode="request" />
			</Container>
		)
	}

	if (error || !request) {
		return (
			<Container>
				<PageHeader title={t('srp.detail.notFoundTitle')} />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">{t('srp.detail.loadFailed')}</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : t('srp.detail.notFound')}
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">{t('srp.common.backDashboard')}</Link>
					</Button>
				</div>
			</Container>
		)
	}

	const isSrpStaff =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')
	const canOpenHrUserProfile = isAdmin || hasPermission('urn:hr:auditor')
	const canWithdraw =
		user?.id === request.userId &&
		(request.requestStatus === 'pending' || request.requestStatus === 'needs_context')
	const canReopen = user?.id === request.userId && request.requestStatus === 'withdrawn'
	const appliedModifiers = request.appliedModifiers ?? []

	const handleWithdraw = async () => {
		if (!id) return
		requestConfirmation({
			title: (t) => t('srp.detail.withdrawTitle'),
			description: (t) => t('srp.detail.withdrawDescription'),
			confirmLabel: (t) => t('srp.detail.withdraw'),
			intent: 'destructive',
			onConfirm: async () => {
				await withdrawRequest.mutateAsync({ id })
				void navigate('/srp')
			},
		})
	}

	const handleReopen = async () => {
		if (!id) return
		requestConfirmation({
			title: (t) => t('srp.detail.reopenTitle'),
			description: (t) => t('srp.detail.reopenDescription'),
			confirmLabel: (t) => t('srp.detail.reopen'),
			intent: 'confirm',
			onConfirm: async () => {
				await createRequest.mutateAsync({
					characterId: request.characterId,
					killmailId: request.id,
					killmailHash: request.killmailHash,
					contextText: request.contextText?.trim() || t('srp.detail.reopened'),
				})
				void navigate(`/srp/request/${id}`)
			},
		})
	}

	if (user?.id && request.userId !== user.id) {
		if (isSrpStaff) {
			return <Navigate to={`/srp/review/${id}`} replace />
		}

		return (
			<Container>
				<PageHeader title={t('srp.detail.denied')} />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">{t('srp.detail.deniedDescription')}</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">{t('srp.common.backDashboard')}</Link>
					</Button>
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title={t('srp.detail.heading', { id: request.id })}
				description={
					<span className="inline-flex items-center gap-2">
						<span className="text-lg font-semibold text-foreground">{t('srp.detail.status')}</span>
						<RequestStatusBadge
							status={request.requestStatus}
							className="px-3 py-1 text-base font-semibold"
						/>
					</span>
				}
				action={
					<div className="flex items-center gap-2">
						{canWithdraw && (
							<Button
								variant="destructive"
								size="sm"
								onClick={handleWithdraw}
								disabled={withdrawRequest.isPending || createRequest.isPending}
							>
								{t('srp.detail.withdraw')}
							</Button>
						)}
						{canReopen && (
							<Button
								variant="primary"
								size="sm"
								onClick={handleReopen}
								disabled={createRequest.isPending || withdrawRequest.isPending}
							>
								{t('srp.detail.reopen')}
							</Button>
						)}
						<Button variant="ghost" size="sm" asChild>
							<Link to="/srp">
								<ArrowLeft className="mr-2 h-4 w-4" />
								{t('srp.detail.backDashboard')}
							</Link>
						</Button>
					</div>
				}
			/>

			<div className="space-y-6">
				{/* Killmail Details */}
				<Card className="p-6">
					<h3 className="mb-4 font-semibold">{t('srp.detail.lossDetails')}</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.common.ship')}</div>
							<div className="font-medium">{request.shipTypeName}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.detail.lossmailId')}</div>
							<div className="font-mono font-medium break-all">{request.id}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.detail.approvedPayout')}</div>
							<div className="font-medium tabular-nums text-success">
								{request.approvedAmount ? formatISK(request.approvedAmount) : '—'}
							</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.detail.lossSystem')}</div>
							<div className="font-medium">
								{request.solarSystemName ?? t('srp.common.unknown')}
							</div>
							{request.solarSystemRegionName ? (
								<div className="text-xs text-muted-foreground">{request.solarSystemRegionName}</div>
							) : null}
						</div>
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.common.character')}</div>
							<div className="inline-flex items-center gap-2 font-medium">
								{canOpenHrUserProfile ? (
									<Link to={`/hr/users/${request.userId}`} className="text-primary hover:underline">
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
							<div className="text-sm text-muted-foreground">{t('srp.common.corporation')}</div>
							<div className="font-medium">{request.corporationName}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.common.lossDate')}</div>
							<EveTimeDisplay dateStr={request.lossDate} className="font-medium" />
						</div>
						<div>
							<Button variant="ghost" size="sm" asChild>
								<a href={getKillmailUrl(request.id)} target="_blank" rel="noopener noreferrer">
									{t('srp.common.zkillArrow')}
								</a>
							</Button>
						</div>
					</div>
				</Card>

				{/* Review Adjustments */}
				<Card className="p-6">
					<h3 className="mb-4 font-semibold">{t('srp.detail.adjustments')}</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<div className="text-sm text-muted-foreground">{t('srp.detail.coveragePolicy')}</div>
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
												variant={modifier.modifierType === 'deduction' ? 'destructive' : 'success'}
											>
												{modifier.modifierType === 'deduction'
													? t('srp.common.deduction')
													: t('srp.common.bonus')}
											</Badge>
											<span className="font-semibold">{formatAppliedModifierValue(modifier)}</span>
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

				{/* Timeline */}
				{request.history && request.history.length > 0 && (
					<RequestHistory history={request.history} />
				)}

				{/* Comments */}
				<Card className="p-6">
					<h3 className="mb-4 font-semibold">{t('srp.common.comments')}</h3>
					<CommentsList
						comments={comments.filter((c: any) => c.visibility === 'public')}
						requestId={id}
						canAddInternal={false}
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
						onCommentAdded={() => refetchComments()}
					/>
					<div className="mt-4 border-t border-border/40 pt-4">
						<CommentForm
							requestId={id}
							canAddInternal={false}
							onSuccess={() => refetchComments()}
						/>
					</div>
				</Card>
			</div>
			{confirmationDialog}
		</Container>
	)
}
