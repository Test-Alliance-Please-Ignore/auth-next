import { ArrowLeft, ExternalLink } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useActivityLogs, useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { formatDateTime, formatRelativeTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import type { AppTranslationKey } from '@/i18n'

const activityActionKeys: Partial<Record<string, AppTranslationKey>> = {
	login: 'admin.users.activity.actions.login',
	logout: 'admin.users.activity.actions.logout',
	character_linked: 'admin.users.activity.actions.character_linked',
	character_unlinked: 'admin.users.activity.actions.character_unlinked',
	character_primary_changed: 'admin.users.activity.actions.character_primary_changed',
	session_created: 'admin.users.activity.actions.session_created',
	session_expired: 'admin.users.activity.actions.session_expired',
	role_granted: 'admin.users.activity.actions.role_granted',
	role_revoked: 'admin.users.activity.actions.role_revoked',
	admin_user_deleted: 'admin.users.activity.actions.admin_user_deleted',
	admin_character_deleted: 'admin.users.activity.actions.admin_character_deleted',
	admin_character_transferred: 'admin.users.activity.actions.admin_character_transferred',
	admin_user_viewed: 'admin.users.activity.actions.admin_user_viewed',
	admin_character_viewed: 'admin.users.activity.actions.admin_character_viewed',
}

export default function AdminUserActivityPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.users.activity.pageTitle'))
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
					<ArrowLeft className="h-4 w-4" />
					{t('admin.users.account.backToUser')}
				</Button>
				<Button variant="ghost" asChild size="sm">
					<Link to={`/admin/activity-log?userId=${userId}`}>
						{t('admin.users.activity.openGlobal')}
						<ExternalLink className="h-4 w-4 ml-2" />
					</Link>
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">{t('admin.users.activity.title')}</h1>
				<p className="text-muted-foreground">
					{userLoading
						? t('admin.users.account.loadingUser')
						: t('admin.users.activity.description', {
								name:
									user?.characters.find((c) => c.is_primary)?.characterName ||
									t('admin.users.account.user'),
							})}
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t('admin.users.activity.entries')}</CardTitle>
					<CardDescription>{t('admin.users.activity.lastEntries')}</CardDescription>
				</CardHeader>
				<CardContent>
					{activityLoading ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.users.activity.loading')}
						</div>
					) : activityRows.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.users.activity.empty')}
						</div>
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
												variant="ghost"
												className={cn(
													log.action.includes('login') && 'border-green-500 text-green-500',
													log.action.includes('create') && 'border-blue-500 text-blue-500',
													log.action.includes('delete') && 'border-red-500 text-red-500',
													log.action.includes('update') && 'border-yellow-500 text-yellow-500'
												)}
											>
												{activityActionKeys[log.action]
													? t(activityActionKeys[log.action]!)
													: log.action}
											</Badge>
											<span
												className="text-sm text-muted-foreground"
												title={formatDateTime(log.createdAt)}
											>
												{formatRelativeTime(log.createdAt)}
											</span>
										</div>
										{log.characterName && (
											<div className="text-sm mt-1">
												{t('admin.users.activity.character', { name: log.characterName })}
											</div>
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
