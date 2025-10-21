import { format } from 'date-fns'
import { UserMinus, Shield, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

import type { GroupMember, GroupWithDetails } from '@/lib/api'

interface MemberListProps {
	members: GroupMember[]
	group: GroupWithDetails
	adminUserIds?: Set<string>
	onRemoveMember: (userId: string) => void
	onToggleAdmin: (userId: string, isCurrentlyAdmin: boolean) => void
	isLoading?: boolean
}

export function MemberList({
	members,
	group,
	adminUserIds = new Set(),
	onRemoveMember,
	onToggleAdmin,
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
							<TableRow key={member.id}>
								<TableCell className="font-medium">{member.userId}</TableCell>
								<TableCell>
									<div className="flex gap-2">
										{isOwner && <Badge>Owner</Badge>}
										{isAdmin && !isOwner && <Badge variant="secondary">Admin</Badge>}
										{!isOwner && !isAdmin && (
											<Badge variant="outline">Member</Badge>
										)}
									</div>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{format(new Date(member.joinedAt), 'MMM d, yyyy')}
								</TableCell>
								<TableCell className="text-right">
									<div className="flex justify-end gap-2">
										{!isOwner && (
											<>
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
											</>
										)}
									</div>
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}
