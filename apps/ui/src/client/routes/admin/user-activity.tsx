import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useActivityLogs, useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export default function AdminUserActivityPage() {
	usePageTitle('Admin - User Activity')
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()

	const { data: user, isLoading: userLoading } = useAdminUser(userId!)
	const { data: activityData, isLoading: activityLoading } = useActivityLogs({
		userId: userId!,
		pageSize: 100,
	})

	const activityRows = activityData?.data || []

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4 mr-2" />
					Back to User
				</Button>
				<Button variant="ghost" asChild size="sm">
					<Link to={`/admin/activity-log?userId=${userId}`}>
						Open Global Activity Log View
						<ExternalLink className="h-4 w-4 ml-2" />
					</Link>
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">User Activity</h1>
				<p className="text-muted-foreground">
					{userLoading
						? 'Loading user...'
						: `Recent admin activity for ${user?.characters.find((c) => c.is_primary)?.characterName || 'user'}`}
				</p>
			</div>

			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Activity Entries</CardTitle>
					<CardDescription>Last 100 entries for this user</CardDescription>
				</CardHeader>
				<CardContent>
					{activityLoading ? (
						<div className="text-center py-8 text-muted-foreground">Loading activity...</div>
					) : activityRows.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No recent activity</div>
					) : (
						<div className="space-y-3">
							{activityRows.map((log) => (
								<div
									key={log.id}
									className="flex items-start gap-3 p-3 rounded-md border border-border bg-muted/30"
								>
									<div className="flex-1">
										<div className="flex items-center gap-2 flex-wrap">
											<Badge
												variant="outline"
												className={cn(
													log.action.includes('login') && 'border-green-500 text-green-500',
													log.action.includes('create') && 'border-blue-500 text-blue-500',
													log.action.includes('delete') && 'border-red-500 text-red-500',
													log.action.includes('update') && 'border-yellow-500 text-yellow-500'
												)}
											>
												{log.action}
											</Badge>
											<span className="text-sm text-muted-foreground" title={formatDateTime(log.createdAt)}>
												{formatRelativeTime(log.createdAt)}
											</span>
										</div>
										{log.characterName && (
											<div className="text-sm mt-1">Character: {log.characterName}</div>
										)}
										{log.metadata && (
											<pre className="mt-2 rounded bg-muted p-2 text-xs overflow-x-auto">
												{JSON.stringify(log.metadata, null, 2)}
											</pre>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
