import { ArrowLeft, Check, Copy, Plus, Ticket, Trash2, UserCog, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { GroupCard } from '@/components/group-card'
import { InviteMemberForm } from '@/components/invite-member-form'
import { JoinButton } from '@/components/join-button'
import { LeaveButton } from '@/components/leave-button'
import { MemberList } from '@/components/member-list'
import { PendingJoinRequestsList } from '@/components/pending-join-requests-list'
import { TransferOwnershipDialog } from '@/components/transfer-ownership-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Section } from '@/components/ui/section'
import { useAuth } from '@/hooks/useAuth'
import { useGroupMembers, useRemoveMember, useToggleAdmin } from '@/hooks/useGroupMembers'
import { useGroup } from '@/hooks/useGroups'
import {
	useCreateInviteCode,
	useGroupInviteCodes,
	useRevokeInviteCode,
} from '@/hooks/useInviteCodes'
import { useMessage } from '@/hooks/useMessage'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDate, formatNumber, useAppTranslation } from '@/i18n'

export default function GroupDetailPage() {
	const { t } = useAppTranslation()
	const { groupId } = useParams<{ groupId: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const { showSuccess, showError } = useMessage()
	const { data: group, isLoading } = useGroup(groupId!)
	const canManageGroup = Boolean(group?.isOwner || group?.isAdmin)
	const isAdminManaged = group?.joinMode === 'admin_managed'
	const { data: members, isLoading: membersLoading } = useGroupMembers(groupId!, canManageGroup)

	// Member management hooks
	const removeMember = useRemoveMember()
	const toggleAdmin = useToggleAdmin()

	// Invite code hooks
	const { data: inviteCodes = [] } = useGroupInviteCodes(
		groupId!,
		canManageGroup && !isAdminManaged
	)
	const createInviteCode = useCreateInviteCode()
	const revokeInviteCode = useRevokeInviteCode()

	// Set dynamic page title based on group name
	usePageTitle(group?.name || t('groupDetail.title'))

	// Dialog state
	const [transferDialogOpen, setTransferDialogOpen] = useState(false)
	const [showCreateInviteCodeDialog, setShowCreateInviteCodeDialog] = useState(false)
	const [removeMemberDialogOpen, setRemoveMemberDialogOpen] = useState(false)
	const [memberToRemove, setMemberToRemove] = useState<{ userId: string; name: string } | null>(
		null
	)
	const [inviteCodeSettings, setInviteCodeSettings] = useState({
		maxUses: null as number | null,
		expiresInDays: 7,
	})
	const [copiedCode, setCopiedCode] = useState<string | null>(null)

	// Invite code handlers
	const handleCreateInviteCode = async () => {
		if (!groupId) return

		try {
			await createInviteCode.mutateAsync({
				groupId,
				maxUses: inviteCodeSettings.maxUses,
				expiresInDays: inviteCodeSettings.expiresInDays,
			})
			setShowCreateInviteCodeDialog(false)
			setInviteCodeSettings({ maxUses: null, expiresInDays: 7 })
		} catch (error) {
			console.error('Failed to create invite code:', error)
		}
	}

	const handleRevokeInviteCode = async (codeId: string) => {
		if (!groupId) return

		try {
			await revokeInviteCode.mutateAsync({ codeId, groupId })
		} catch (error) {
			console.error('Failed to revoke invite code:', error)
		}
	}

	const handleCopyCode = async (code: string) => {
		try {
			await navigator.clipboard.writeText(code)
			setCopiedCode(code)
			setTimeout(() => setCopiedCode(null), 2000)
		} catch (error) {
			console.error('Failed to copy code to clipboard:', error)
		}
	}

	// Member management handlers
	const handleRemoveMember = (userId: string) => {
		const member = members?.find((m) => m.userId === userId)
		if (member) {
			setMemberToRemove({
				userId,
				name: member.mainCharacterName || '',
			})
			setRemoveMemberDialogOpen(true)
		}
	}

	const handleConfirmRemove = async () => {
		if (!groupId || !memberToRemove) return

		try {
			await removeMember.mutateAsync({ groupId, userId: memberToRemove.userId })
			showSuccess(
				t('groupDetail.memberRemoved', {
					name: memberToRemove.name || t('groupDetail.unknownUser'),
				})
			)
			setRemoveMemberDialogOpen(false)
			setMemberToRemove(null)
		} catch (error) {
			showError(error instanceof Error ? error.message : t('groupDetail.removeFailed'))
		}
	}

	const handleToggleAdmin = async (userId: string, isCurrentlyAdmin: boolean) => {
		if (!groupId) return

		const member = members?.find((m) => m.userId === userId)
		if (!member) return

		try {
			await toggleAdmin.mutateAsync({ groupId, userId, isCurrentlyAdmin })
			const name = member.mainCharacterName || t('groupDetail.memberFallback')
			showSuccess(
				isCurrentlyAdmin
					? t('groupDetail.adminRemoved', { name })
					: t('groupDetail.adminAdded', { name })
			)
		} catch (error) {
			showError(error instanceof Error ? error.message : t('groupDetail.adminUpdateFailed'))
		}
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">{t('groupDetail.loading')}</p>
			</div>
		)
	}

	if (!group) {
		return (
			<div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
				<p className="text-muted-foreground">{t('groupDetail.notFound')}</p>
				<Button onClick={() => navigate('/groups')}>
					<ArrowLeft className="h-4 w-4" />
					{t('groupDetail.back')}
				</Button>
			</div>
		)
	}

	return (
		<Container>
			<Section>
				{/* Back Button */}
				<Button variant="ghost" onClick={() => navigate('/groups')}>
					<ArrowLeft className="h-4 w-4" />
					{t('groupDetail.back')}
				</Button>

				{/* Group Info */}
				<GroupCard group={group} />

				{/* Actions - Hide for owners */}
				{!group.isOwner && (
					<Card>
						<CardHeader>
							<CardTitle>{t('groupDetail.actions')}</CardTitle>
							<CardDescription>{t('groupDetail.actionsDescription')}</CardDescription>
						</CardHeader>
						<CardContent className="flex gap-3">
							<JoinButton
								group={group}
								onSuccess={() => {
									void navigate('/my-groups')
								}}
							/>
							<LeaveButton
								group={group}
								onSuccess={() => {
									void navigate('/my-groups')
								}}
							/>
						</CardContent>
					</Card>
				)}

				{/* Members List - Only show to group owners and admins */}
				{canManageGroup && (
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Users className="h-5 w-5" />
								{t('groupDetail.members', {
									count: group.memberCount || 0,
									formattedCount: formatNumber(group.memberCount || 0),
								})}
							</CardTitle>
							<CardDescription>{t('groupDetail.membersDescription')}</CardDescription>
						</CardHeader>
						<CardContent>
							<MemberList
								members={members || []}
								group={group}
								adminUserIds={new Set(group.adminUserIds || [])}
								currentUserId={user?.id}
								onRemoveMember={handleRemoveMember}
								onToggleAdmin={handleToggleAdmin}
								isLoading={membersLoading}
							/>
						</CardContent>
					</Card>
				)}

				{/* Pending Join Requests - Owner/Admin Only */}
				{canManageGroup && !isAdminManaged && <PendingJoinRequestsList groupId={groupId!} />}

				{/* Invite Member Form - Owner/Admin Only */}
				{canManageGroup && (
					<InviteMemberForm group={group} allowDirectAdd={user?.is_admin ?? false} />
				)}

				{/* Invite Codes - Owner/Admin Only */}
				{canManageGroup && !isAdminManaged && (
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<div className="flex items-center gap-2">
										<Ticket className="h-5 w-5 text-primary" />
										<CardTitle>{t('groupDetail.inviteCodes.title')}</CardTitle>
									</div>
									<CardDescription>{t('groupDetail.inviteCodes.description')}</CardDescription>
								</div>
								<Button onClick={() => setShowCreateInviteCodeDialog(true)} size="sm">
									<Plus className="h-4 w-4" />
									{t('groupDetail.inviteCodes.create')}
								</Button>
							</div>
						</CardHeader>
						<CardContent>
							{inviteCodes.length === 0 ? (
								<div className="text-center py-8">
									<Ticket className="mx-auto h-12 w-12 text-muted-foreground" />
									<h3 className="mt-4 text-sm font-medium">{t('groupDetail.inviteCodes.empty')}</h3>
									<p className="text-sm text-muted-foreground mt-2">
										{t('groupDetail.inviteCodes.emptyDescription')}
									</p>
								</div>
							) : (
								<div className="space-y-3">
									{inviteCodes.map((inviteCode) => {
										const isRevoked = inviteCode.revokedAt !== null
										const isExpired = new Date(inviteCode.expiresAt) < new Date()
										const isMaxedOut =
											!isRevoked &&
											!isExpired &&
											inviteCode.maxUses !== null &&
											inviteCode.currentUses >= inviteCode.maxUses
										const statusLabel = isRevoked
											? t('groupDetail.inviteCodes.revoked')
											: isExpired
												? t('duration.expired')
												: isMaxedOut
													? t('groupDetail.inviteCodes.maxUsesReached')
													: null
										const inviteUrl = `${window.location.origin}/invite/${inviteCode.code}`

										return (
											<div
												key={inviteCode.id}
												className={`rounded-lg border p-4 ${statusLabel ? 'opacity-50' : ''}`}
											>
												<div className="flex items-start justify-between">
													<div className="flex-1 space-y-2">
														<div className="flex items-center gap-2">
															<code className="text-sm font-mono bg-muted px-2 py-1 rounded">
																{inviteCode.code}
															</code>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleCopyCode(inviteCode.code)}
																className="h-7 px-2"
																title={t('groupDetail.inviteCodes.copyCode')}
																aria-label={t('groupDetail.inviteCodes.copyCode')}
															>
																{copiedCode === inviteCode.code ? (
																	<Check className="h-4 w-4 text-green-500" />
																) : (
																	<Copy className="h-4 w-4" />
																)}
															</Button>
															{statusLabel && (
																<span className="text-xs text-destructive font-medium">
																	{statusLabel}
																</span>
															)}
														</div>
														<div className="flex items-center gap-2 text-xs">
															<code className="bg-muted/50 px-2 py-1 rounded text-muted-foreground truncate max-w-md">
																{inviteUrl}
															</code>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleCopyCode(inviteUrl)}
																className="h-7 px-2 shrink-0"
																title={t('groupDetail.inviteCodes.copyUrl')}
																aria-label={t('groupDetail.inviteCodes.copyUrl')}
															>
																{copiedCode === inviteUrl ? (
																	<Check className="h-4 w-4 text-green-500" />
																) : (
																	<Copy className="h-4 w-4" />
																)}
															</Button>
														</div>
														<div className="flex gap-4 text-xs text-muted-foreground">
															<span>
																{inviteCode.maxUses
																	? t('groupDetail.inviteCodes.usesLimited', {
																			current: formatNumber(inviteCode.currentUses),
																			maximum: formatNumber(inviteCode.maxUses),
																		})
																	: t('groupDetail.inviteCodes.usesUnlimited', {
																			current: formatNumber(inviteCode.currentUses),
																		})}
															</span>
															<span>
																{t('groupDetail.inviteCodes.expires', {
																	date: formatDate(inviteCode.expiresAt),
																})}
															</span>
															<span>
																{t('groupDetail.inviteCodes.created', {
																	date: formatDate(inviteCode.createdAt),
																})}
															</span>
														</div>
													</div>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleRevokeInviteCode(inviteCode.id)}
														aria-label={t('groupDetail.inviteCodes.revoke', {
															code: inviteCode.code,
														})}
														disabled={revokeInviteCode.isPending}
													>
														<Trash2 className="h-4 w-4 text-destructive" />
													</Button>
												</div>
											</div>
										)
									})}
								</div>
							)}

							{/* Create Invite Code Dialog */}
							<Dialog
								open={showCreateInviteCodeDialog}
								onOpenChange={setShowCreateInviteCodeDialog}
							>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>{t('groupDetail.inviteCodes.createTitle')}</DialogTitle>
										<DialogDescription>
											{t('groupDetail.inviteCodes.createDescription')}
										</DialogDescription>
									</DialogHeader>

									<div className="space-y-4">
										<div className="space-y-2">
											<Label htmlFor="max-uses">{t('groupDetail.inviteCodes.maxUses')}</Label>
											<Input
												id="max-uses"
												type="number"
												min="1"
												placeholder={t('groupDetail.inviteCodes.unlimited')}
												value={inviteCodeSettings.maxUses ?? ''}
												onChange={(e) =>
													setInviteCodeSettings({
														...inviteCodeSettings,
														maxUses: e.target.value ? parseInt(e.target.value) : null,
													})
												}
											/>
											<p className="text-xs text-muted-foreground">
												{t('groupDetail.inviteCodes.maxUsesHint')}
											</p>
										</div>

										<div className="space-y-2">
											<Label htmlFor="expires-in-days">
												{t('groupDetail.inviteCodes.expiresInDays')}
											</Label>
											<Input
												id="expires-in-days"
												type="number"
												min="1"
												max="30"
												value={inviteCodeSettings.expiresInDays}
												onChange={(e) =>
													setInviteCodeSettings({
														...inviteCodeSettings,
														expiresInDays: parseInt(e.target.value) || 7,
													})
												}
											/>
											<p className="text-xs text-muted-foreground">
												{t('groupDetail.inviteCodes.expiryHint')}
											</p>
										</div>
									</div>

									<DialogFooter>
										<Button
											variant="cancel"
											onClick={() => {
												setShowCreateInviteCodeDialog(false)
												setInviteCodeSettings({ maxUses: null, expiresInDays: 7 })
											}}
										>
											{t('common.cancel')}
										</Button>
										<Button
											variant="confirm"
											onClick={handleCreateInviteCode}
											loading={createInviteCode.isPending}
											loadingText={t('groupDetail.inviteCodes.creating')}
										>
											{t('groupDetail.inviteCodes.create')}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</CardContent>
					</Card>
				)}

				{/* Transfer Ownership - Owner Only */}
				{group.isOwner && (
					<Card className="border-amber-500/50">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<UserCog className="h-5 w-5" />
								{t('groupDetail.transfer.title')}
							</CardTitle>
							<CardDescription>{t('groupDetail.transfer.cardDescription')}</CardDescription>
						</CardHeader>
						<CardContent>
							<Button variant="ghost" onClick={() => setTransferDialogOpen(true)}>
								<UserCog className="h-4 w-4" />
								{t('groupDetail.transfer.title')}
							</Button>
						</CardContent>
					</Card>
				)}

				{/* Remove Member Confirmation Dialog */}
				<Dialog open={removeMemberDialogOpen} onOpenChange={setRemoveMemberDialogOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t('groupDetail.remove.title')}</DialogTitle>
							<DialogDescription>
								{t('groupDetail.remove.description', {
									name: memberToRemove?.name || t('groupDetail.unknownUser'),
								})}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="cancel" onClick={() => setRemoveMemberDialogOpen(false)}>
								{t('common.cancel')}
							</Button>
							<Button
								variant="destructive"
								onClick={handleConfirmRemove}
								loading={removeMember.isPending}
								loadingText={t('groupDetail.remove.removing')}
							>
								{t('groupDetail.remove.submit')}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				{/* Transfer Ownership Dialog */}
				{group && members && (
					<TransferOwnershipDialog
						group={group}
						members={members}
						open={transferDialogOpen}
						onOpenChange={setTransferDialogOpen}
						onSuccess={() => {
							void navigate('/my-groups')
						}}
					/>
				)}
			</Section>
		</Container>
	)
}
