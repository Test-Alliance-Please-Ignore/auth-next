import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

interface GroupMembership {
	groupId: string
	groupName: string
	membershipLevel: 'member' | 'admin' | 'owner'
	joinedAt: string
}

interface UserGroupMembershipsTableProps {
	memberships: GroupMembership[]
	getGroupPath?: (groupId: string) => string
}

export function UserGroupMembershipsTable({
	memberships,
	getGroupPath,
}: UserGroupMembershipsTableProps) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Group</TableHead>
					<TableHead>Level</TableHead>
					<TableHead>Joined</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{memberships.map((membership) => {
					const groupPath = getGroupPath?.(membership.groupId)
					return (
						<TableRow key={membership.groupId}>
							<TableCell>
								<div className="flex items-center gap-2">
									{groupPath ? (
										<>
											<Link
												to={groupPath}
												className="font-medium hover:text-primary transition-colors"
											>
												{membership.groupName}
											</Link>
											<ExternalLink className="h-3 w-3 text-muted-foreground" />
										</>
									) : (
										<span className="font-medium">{membership.groupName}</span>
									)}
								</div>
								<div className="text-xs text-muted-foreground">{membership.groupId}</div>
							</TableCell>
							<TableCell>
								<Badge
									variant="default"
									className={
										membership.membershipLevel === 'owner'
											? 'bg-primary/20 text-primary'
											: membership.membershipLevel === 'admin'
												? 'bg-blue-500/20 text-blue-500'
												: 'bg-muted/50 text-muted-foreground'
									}
								>
									{membership.membershipLevel === 'owner'
										? 'Owner'
										: membership.membershipLevel === 'admin'
											? 'Admin'
											: 'Member'}
								</Badge>
							</TableCell>
							<TableCell>
								<div className="text-sm" title={formatDateTime(membership.joinedAt)}>
									{formatRelativeTime(membership.joinedAt)}
								</div>
							</TableCell>
						</TableRow>
					)
				})}
			</TableBody>
		</Table>
	)
}
