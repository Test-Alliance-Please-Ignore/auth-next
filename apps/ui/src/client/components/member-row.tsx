import { format } from 'date-fns'

import { MemberAvatar } from '@/components/member-avatar'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

import type { GroupMember, GroupWithDetails } from '@/lib/api'

interface MemberRowProps {
	member: GroupMember
	group: GroupWithDetails
	adminUserIds?: Set<string>
	currentUserId?: string
	/** Optional actions to display in the last column */
	actions?: React.ReactNode
}

/**
 * Reusable member row component for displaying group member information
 * Handles avatar, name, role badges, join date, and optional action buttons
 */
export function MemberRow({
	member,
	group,
	adminUserIds = new Set(),
	currentUserId,
	actions,
}: MemberRowProps) {
	const isOwner = member.userId === group.ownerId
	const isAdmin = adminUserIds.has(member.userId)
	const isCurrentUser = currentUserId === member.userId

	return (
		<TableRow className={cn(isCurrentUser && 'bg-primary/5')}>
			{/* Avatar */}
			<TableCell className="py-2 px-2">
				<MemberAvatar
					characterId={member.mainCharacterId}
					characterName={member.mainCharacterName}
				/>
			</TableCell>

			{/* Member Name */}
			<TableCell className="font-medium">{member.mainCharacterName || 'Unknown User'}</TableCell>

			{/* Role Badges */}
			<TableCell>
				<div className="flex gap-2">
					{isOwner && <Badge>Owner</Badge>}
					{isAdmin && !isOwner && <Badge variant="secondary">Admin</Badge>}
					{!isOwner && !isAdmin && <Badge variant="outline">Member</Badge>}
				</div>
			</TableCell>

			{/* Join Date */}
			<TableCell className="text-sm text-muted-foreground">
				{format(new Date(member.joinedAt), 'MMM d, yyyy')}
			</TableCell>

			{/* Actions (optional) */}
			{actions && <TableCell className="text-right">{actions}</TableCell>}
		</TableRow>
	)
}
