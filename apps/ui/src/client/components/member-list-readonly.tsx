import { MemberRow } from '@/components/member-row'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
						<TableHead className="w-20 px-2"></TableHead>
						<TableHead>Member</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Joined</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{members.map((member) => (
						<MemberRow
							key={member.id}
							member={member}
							group={group}
							adminUserIds={adminUserIds}
							currentUserId={currentUserId}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	)
}
