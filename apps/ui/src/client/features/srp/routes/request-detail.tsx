import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { roundToMillion } from '@repo/srp'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { CommentForm } from '../components/CommentForm'
import { CommentsList } from '../components/CommentsList'
import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import { RequestHistory } from '../components/RequestHistory'
import { SRPRequestDetailSkeleton } from '../components/SRPRequestDetailSkeleton'
import { RequestStatusBadge } from '../components/RequestStatusBadge'
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

	return `${sign}${modifier.amount}% (${formatISK(roundedToNearestMillion)})`
}

export default function RequestDetails() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { hasPermission, isAdmin } = useUserPermissions()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const { data: request, isLoading, error } = useRequest(id)
	const { data: comments = [], refetch: refetchComments } = useRequestComments(id, false)
	const createRequest = useCreateRequest()
	const withdrawRequest = useWithdrawRequest()

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
				<PageHeader title="Request Not Found" />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">Failed to load request</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : 'Request not found'}
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">Back to Dashboard</Link>
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
	const canWithdraw =
		user?.id === request.userId &&
		(request.requestStatus === 'pending' || request.requestStatus === 'needs_context')
	const canReopen = user?.id === request.userId && request.requestStatus === 'withdrawn'

	const handleWithdraw = async () => {
		if (!id) return
		requestConfirmation({
			title: 'Withdraw SRP Request',
			description:
				'Withdraw this SRP request? You can re-submit it later from Recent Losses.',
			confirmLabel: 'Withdraw Request',
			intent: 'destructive',
			onConfirm: async () => {
				await withdrawRequest.mutateAsync({ id })
				navigate('/srp')
			},
		})
	}

	const handleReopen = async () => {
		if (!id) return
		requestConfirmation({
			title: 'Reopen SRP Request',
			description:
				'Reopen this withdrawn SRP request? This will move it back to pending review.',
			confirmLabel: 'Reopen Request',
			intent: 'confirm',
			onConfirm: async () => {
				await createRequest.mutateAsync({
					characterId: request.characterId,
					killmailId: request.id,
					killmailHash: request.killmailHash,
					contextText: request.contextText?.trim() || 'Reopened SRP request',
				})
				navigate(`/srp/request/${id}`)
			},
		})
	}

	if (user?.id && request.userId !== user.id) {
		if (isSrpStaff) {
			return <Navigate to={`/srp/review/${id}`} replace />
		}

		return (
			<Container>
				<PageHeader title="Permission Denied" />
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">
						You are not authorized to view this SRP request.
					</p>
					<Button variant="ghost" className="mt-4" asChild>
						<Link to="/srp">Back to Dashboard</Link>
					</Button>
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title={`SRP Request #${request.id.slice(0, 8)}`}
				description={
					<span className="inline-flex items-center gap-2">
						<span className="text-lg font-semibold text-foreground">Status:</span>
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
								Withdraw Request
							</Button>
						)}
						{canReopen && (
							<Button
								variant="primary"
								size="sm"
								onClick={handleReopen}
								disabled={createRequest.isPending || withdrawRequest.isPending}
							>
								Reopen Request
							</Button>
						)}
						<Button variant="ghost" size="sm" asChild>
							<Link to="/srp">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back to SRP Dashboard
							</Link>
						</Button>
					</div>
				}
			/>

			<div className="space-y-6">
				{/* Killmail Details */}
				<Card className="p-6">
					<h3 className="mb-4 font-semibold">Loss Details</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<div className="text-sm text-muted-foreground">Ship</div>
							<div className="font-medium">{request.shipTypeName}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">Approved Payout</div>
							<div className="font-medium tabular-nums text-success">
								{request.approvedAmount ? formatISK(request.approvedAmount) : '—'}
							</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">Loss System</div>
							<div className="font-medium">{request.solarSystemName ?? 'Unknown'}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">Character</div>
							<div className="inline-flex items-center gap-2 font-medium">
								<span>{request.characterName}</span>
								<CharacterRoleBadge
									role={getRequestCharacterRole(request)}
									mainCharacterName={request.mainCharacterName}
									mainCharacterId={request.mainCharacterId}
								/>
							</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">Corporation</div>
							<div className="font-medium">{request.corporationName}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">Loss Date</div>
							<EveTimeDisplay dateStr={request.lossDate} className="font-medium" />
						</div>
						<div>
							<Button variant="ghost" size="sm" asChild>
								<a
									href={getKillmailUrl(request.id)}
									target="_blank"
									rel="noopener noreferrer"
								>
									View on zKillboard →
								</a>
							</Button>
						</div>
					</div>
				</Card>

				{/* Review Adjustments */}
				<Card className="p-6">
					<h3 className="mb-4 font-semibold">Review Adjustments</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<div>
							<div className="text-sm text-muted-foreground">Coverage Policy</div>
							<div className="font-medium">{request.appliedModifierPolicyName ?? 'None'}</div>
						</div>
						<div>
							<div className="text-sm text-muted-foreground">Cap Policy</div>
							<div className="font-medium">{request.appliedCapPolicyName ?? 'None'}</div>
						</div>
					</div>

					<div className="mt-4">
						<div className="text-sm text-muted-foreground">Bonuses / Deductions</div>
						{request.appliedModifiers && request.appliedModifiers.length > 0 ? (
							<ul className="mt-2 space-y-1 text-sm">
								{request.appliedModifiers.map((modifier: {
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
											{modifier.modifierType === 'deduction' ? 'Deduction' : 'Bonus'}
										</Badge>
										<span className="font-semibold">
											{formatAppliedModifierValue(modifier)}
										</span>
										<span className="text-foreground">: {modifier.reason}</span>
									</li>
								))}
							</ul>
						) : (
							<div className="mt-1 text-sm font-medium">None</div>
						)}
					</div>
				</Card>

				{/* Timeline */}
				{request.history && request.history.length > 0 && (
					<RequestHistory history={request.history} />
				)}

				{/* Comments */}
				<Card className="p-6">
					<h3 className="mb-4 font-semibold">Comments</h3>
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
