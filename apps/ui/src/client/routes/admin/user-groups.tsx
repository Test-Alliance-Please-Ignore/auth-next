import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GhostButton } from '@/components/ui/ghost-button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'

export default function AdminUserGroupsPage() {
	usePageTitle('Admin - User Group Memberships')
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()
	const { data: user, isLoading } = useAdminUser(userId!)

	if (isLoading) {
		return <div className="text-center py-8 text-muted-foreground">Loading user group memberships...</div>
	}

	if (!user) {
		return <div className="text-center py-8 text-muted-foreground">User not found</div>
	}

	const memberships = user.groupMemberships ?? []

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<GhostButton onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to User
				</GhostButton>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">User Group Memberships</h1>
				<p className="text-muted-foreground">
					{user.characters.find((c) => c.is_primary)?.characterName || 'User'} belongs to{' '}
					{memberships.length} group{memberships.length === 1 ? '' : 's'}.
				</p>
			</div>

			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Memberships</CardTitle>
					<CardDescription>Group-level access and join dates</CardDescription>
				</CardHeader>
				<CardContent>
					{memberships.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No group memberships</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Group</TableHead>
									<TableHead>Level</TableHead>
									<TableHead>Joined</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{memberships.map((membership) => (
									<TableRow key={membership.groupId}>
										<TableCell>
											<div className="flex items-center gap-2">
												<Link
													to={`/admin/groups/${membership.groupId}`}
													className="font-medium hover:text-primary transition-colors"
												>
													{membership.groupName}
												</Link>
												<ExternalLink className="h-3 w-3 text-muted-foreground" />
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
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
