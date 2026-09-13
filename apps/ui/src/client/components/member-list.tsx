import { Shield, ShieldOff, UserCog, UserMinus } from 'lucide-react'

import { MemberRow } from '@/components/member-row'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAppTranslation } from '@/i18n'

import type { GroupMember, GroupWithDetails } from '@/lib/api'

interface MemberListProps {
	members: GroupMember[]
	group: GroupWithDetails
	adminUserIds?: Set<string>
	currentUserId?: string
	onRemoveMember: (userId: string) => void
	onToggleAdmin: (userId: string, isCurrentlyAdmin: boolean) => void
	onTransferOwnership?: (userId: string) => void
	isLoading?: boolean
}

export function MemberList({
	members,
	group,
	adminUserIds = new Set(),
	currentUserId,
	onRemoveMember,
	onToggleAdmin,
	onTransferOwnership,
	isLoading,
}: MemberListProps) {
	const { t } = useAppTranslation()

	if (isLoading) {
		return (
			<div className="space-y-4">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
				))}
			</div>
		)
	}

	if (members.length === 0) {
		return (
			<div className="rounded-md border border-dashed p-8 text-center">
				<p className="text-muted-foreground">{t('groupDetail.memberList.empty')}</p>
			</div>
		)
	}

	return (
		<div className="rounded-md border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-20 px-2"></TableHead>
						<TableHead>{t('groupDetail.memberList.user')}</TableHead>
						<TableHead>{t('groupDetail.memberList.role')}</TableHead>
						<TableHead>{t('groupDetail.memberList.joined')}</TableHead>
						<TableHead className="text-right">{t('groupDetail.actions')}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{members.map((member) => {
						const isOwner = member.userId === group.ownerId
						const isAdmin = adminUserIds.has(member.userId)
						const cannotRemove = isOwner

						return (
							<MemberRow
								key={member.id}
								member={member}
								group={group}
								adminUserIds={adminUserIds}
								currentUserId={currentUserId}
								actions={
									!isOwner && (
										<div className="flex justify-end gap-2">
											{onTransferOwnership && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => onTransferOwnership(member.userId)}
													title={t('groupDetail.memberList.transferTitle')}
												>
													<UserCog className="h-4 w-4" />
													{t('groupDetail.memberList.makeOwner')}
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onToggleAdmin(member.userId, isAdmin)}
												title={
													isAdmin
														? t('groupDetail.memberList.removeAdminTitle')
														: t('groupDetail.memberList.makeAdminTitle')
												}
											>
												{isAdmin ? (
													<>
														<ShieldOff className="h-4 w-4" />
														{t('groupDetail.memberList.removeAdmin')}
													</>
												) : (
													<>
														<Shield className="h-4 w-4" />
														{t('groupDetail.memberList.makeAdmin')}
													</>
												)}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onRemoveMember(member.userId)}
												disabled={cannotRemove}
												title={
													cannotRemove
														? t('groupDetail.memberList.cannotRemoveOwner')
														: t('groupDetail.memberList.removeMember')
												}
												className="text-destructive hover:text-destructive disabled:text-muted-foreground"
											>
												<UserMinus className="h-4 w-4" />
												{t('groupDetail.memberList.remove')}
											</Button>
										</div>
									)
								}
							/>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}
