import { format } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import type { GroupMember, GroupWithDetails } from '@/lib/api'

interface MemberListReadonlyProps {
	members: GroupMember[]
	group: GroupWithDetails
	currentUserId?: string
	isLoading?: boolean
}

export function MemberListReadonly({
	members,
	group,
	currentUserId,
	isLoading,
}: MemberListReadonlyProps) {
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

	// Get admin user IDs from group data
	const adminUserIds = new Set(group.adminUserIds || [])

	return (
		<div className="rounded-md border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-12"></TableHead>
						<TableHead>Member</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Joined</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{members.map((member) => {
						const isOwner = member.userId === group.ownerId
						const isAdmin = adminUserIds.has(member.userId)
						const isCurrentUser = currentUserId === member.userId

						return (
							<TableRow key={member.id} className={cn(isCurrentUser && 'bg-primary/5')}>
								<TableCell>
									{member.mainCharacterId ? (
										<img
											src={`https://images.evetech.net/characters/${member.mainCharacterId}/portrait?size=64`}
											alt={member.mainCharacterName || 'Character portrait'}
											className="h-12 w-12 rounded"
											loading="lazy"
										/>
									) : (
										<div className="h-12 w-12 rounded bg-muted flex items-center justify-center text-muted-foreground text-xs">
											?
										</div>
									)}
								</TableCell>
								<TableCell className="font-medium">
									{member.mainCharacterName || 'Unknown User'}
								</TableCell>
								<TableCell>
									<div className="flex gap-2">
										{isOwner && <Badge>Owner</Badge>}
										{isAdmin && !isOwner && <Badge variant="secondary">Admin</Badge>}
										{!isOwner && !isAdmin && <Badge variant="outline">Member</Badge>}
									</div>
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{format(new Date(member.joinedAt), 'MMM d, yyyy')}
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</div>
	)
}
