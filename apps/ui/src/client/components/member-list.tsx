import { UserMinus, Shield, ShieldOff, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { MemberRow } from '@/components/member-row'

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
				<p className="text-muted-foreground">No members in this group.</p>
			</div>
		)
	}

	return (
		<div className="rounded-md border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-20 px-2"></TableHead>
						<TableHead>User</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Joined</TableHead>
						<TableHead className="text-right">Actions</TableHead>
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
													title="Transfer ownership to this member"
												>
													<UserCog className="mr-2 h-4 w-4" />
													Make Owner
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onToggleAdmin(member.userId, isAdmin)}
												title={isAdmin ? 'Remove admin role' : 'Make admin'}
											>
												{isAdmin ? (
													<>
														<ShieldOff className="mr-2 h-4 w-4" />
														Remove Admin
													</>
												) : (
													<>
														<Shield className="mr-2 h-4 w-4" />
														Make Admin
													</>
												)}
											</Button>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => onRemoveMember(member.userId)}
												disabled={cannotRemove}
												title={cannotRemove ? 'Cannot remove owner' : 'Remove member'}
												className="text-destructive hover:text-destructive disabled:text-muted-foreground"
											>
												<UserMinus className="mr-2 h-4 w-4" />
												Remove
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
