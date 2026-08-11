import { Calendar, Crown, Shield } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

import { LeaveButton } from './leave-button'

import type { GroupMembershipSummary } from '@/lib/api'

interface MyGroupsTableProps {
	title: string
	description: string
	memberships: GroupMembershipSummary[]
	showActions?: boolean
}

export function MyGroupsTable({
	title,
	description,
	memberships,
	showActions = true,
}: MyGroupsTableProps) {
	return (
		<Card variant="default">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="p-0">
				<div className="rounded-md border-t">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Group</TableHead>
								<TableHead>Category</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead>Mumble</TableHead>
								{showActions && <TableHead className="text-right">Actions</TableHead>}
							</TableRow>
						</TableHeader>
						<TableBody>
							{memberships.map((membership) => {
								const joinedDate = new Date(membership.joinedAt).toLocaleDateString()
								const leaveGroup = {
									id: membership.groupId,
									name: membership.groupName,
									isMember: true,
									isOwner: membership.isOwner,
									joinMode: membership.joinMode ?? 'open',
								}

								return (
									<TableRow key={membership.groupId}>
										<TableCell className="font-medium">
											<Link to={`/groups/${membership.groupId}`} className="hover:underline">
												{membership.groupName}
											</Link>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{membership.categoryName}
										</TableCell>
										<TableCell>
											{membership.isOwner ? (
												<Badge variant="default" className="gap-1">
													<Crown className="h-3 w-3" />
													Owner
												</Badge>
											) : membership.isAdmin ? (
												<Badge variant="secondary" className="gap-1">
													<Shield className="h-3 w-3" />
													Admin
												</Badge>
											) : (
												<span className="text-muted-foreground">Member</span>
											)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-muted-foreground">
											<div className="flex items-center gap-2">
												<Calendar className="h-4 w-4" />
												<span>{joinedDate}</span>
											</div>
										</TableCell>
										<TableCell>
											{membership.mumbleSyncEnabled ? (
												<Badge variant="secondary">
													{membership.mumbleTicker ? `Mumble ${membership.mumbleTicker}` : 'Mumble'}
												</Badge>
											) : (
												<span className="text-muted-foreground">Disabled</span>
											)}
										</TableCell>
										{showActions && (
											<TableCell className="text-right">
												<div className="flex justify-end">
													<LeaveButton group={leaveGroup} compact />
												</div>
											</TableCell>
										)}
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	)
}
