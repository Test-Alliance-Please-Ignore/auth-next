import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminOAuthResolverInspection, useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { formatDateTime } from '@/lib/date-utils'

export default function AdminUserOAuthInspectionPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('admin.users.oauth.pageTitle'))
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()

	const { data: user, isLoading: userLoading } = useAdminUser(userId!)
	const {
		data: inspection,
		isLoading: inspectionLoading,
		error,
	} = useAdminOAuthResolverInspection(userId!, !!userId)

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4" />
					{t('admin.users.account.backToUser')}
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">{t('admin.users.oauth.title')}</h1>
				<p className="text-muted-foreground">
					{userLoading
						? t('admin.users.account.loadingUser')
						: t('admin.users.oauth.description', {
								name:
									user?.characters.find((c) => c.is_primary)?.characterName ||
									t('admin.users.account.user'),
							})}
				</p>
			</div>

			{inspectionLoading ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						{t('admin.users.oauth.loading')}
					</CardContent>
				</Card>
			) : error ? (
				<Card className="border-destructive/30 bg-destructive/10">
					<CardContent className="py-4 text-destructive">
						{t('admin.users.oauth.error')}
					</CardContent>
				</Card>
			) : !inspection ? (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						{t('admin.users.discord.noInspection')}
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>{t('admin.users.oauth.payload')}</CardTitle>
						<CardDescription>
							{t('admin.users.oauth.generated', {
								date: formatDateTime(inspection.inspectedAt),
								id: inspection.userId,
							})}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<pre className="overflow-auto rounded-md border bg-muted/30 p-4 text-xs">
							{JSON.stringify(inspection, null, 2)}
						</pre>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
