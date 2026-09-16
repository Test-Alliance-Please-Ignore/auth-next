import { ArrowLeft } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { UserGroupMembershipsTable } from '@/components/user-group-memberships-table'
import { useAuditorUser } from '@/hooks/useAuditorUsers'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'

export default function HrAuditorUserGroupsPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('hrpages.userSearchGroupMemberships'))
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasAnyPermission } = useUserPermissions()
	const isAuditor = hasAnyPermission('urn:hr:auditor')
	const { data: targetUser, isLoading } = useAuditorUser(userId ?? '')

	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/login" replace />
	}

	if (!authLoading && !isAuditor && !user?.is_admin) {
		return <Navigate to="/corporations" replace />
	}

	if (authLoading || isLoading) {
		return (
			<Container>
				<div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
					{t('hrpages.loadingUserGroupMemberships')}
				</div>
			</Container>
		)
	}

	if (!targetUser) {
		return (
			<Container>
				<div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
					{t('hrpages.userNotFound')}
				</div>
			</Container>
		)
	}

	const memberships = targetUser.groupMemberships ?? []
	const mainCharacterName =
		targetUser.characters.find((c) => c.is_primary)?.characterName ?? t('hrpages.user')

	return (
		<Container className="space-y-6">
			<PageHeader
				title={t('hrpages.userGroupMemberships')}
				description={t('hrpages.groupMembershipCount', {
					count: memberships.length,
					value1: mainCharacterName,
				})}
				action={
					<Button variant="ghost" onClick={() => navigate(`/hr/users/${userId}`)}>
						<ArrowLeft className="h-4 w-4" />
						{t('hrpages.backToUser')}
					</Button>
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t('hrpages.memberships')}</CardTitle>
					<CardDescription>{t('hrpages.groupLevelAccessAndJoinDates')}</CardDescription>
				</CardHeader>
				<CardContent>
					{memberships.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('hrpages.noGroupMemberships')}
						</div>
					) : (
						<UserGroupMembershipsTable memberships={memberships} />
					)}
				</CardContent>
			</Card>
		</Container>
	)
}
