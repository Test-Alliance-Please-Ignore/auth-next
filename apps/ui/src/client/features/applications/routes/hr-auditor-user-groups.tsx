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

export default function HrAuditorUserGroupsPage() {
	usePageTitle('User Search - Group Memberships')
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
					Loading user group memberships...
				</div>
			</Container>
		)
	}

	if (!targetUser) {
		return (
			<Container>
				<div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
					User not found
				</div>
			</Container>
		)
	}

	const memberships = targetUser.groupMemberships ?? []
	const mainCharacterName = targetUser.characters.find((c) => c.is_primary)?.characterName ?? 'User'

	return (
		<Container className="space-y-6">
			<PageHeader
				title="User Group Memberships"
				description={`${mainCharacterName} belongs to ${memberships.length} group${memberships.length === 1 ? '' : 's'}.`}
				action={
					<Button variant="ghost" onClick={() => navigate(`/hr/users/${userId}`)}>
						<ArrowLeft className="h-4 w-4" />
						Back to User
					</Button>
				}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Memberships</CardTitle>
					<CardDescription>Group-level access and join dates</CardDescription>
				</CardHeader>
				<CardContent>
					{memberships.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No group memberships</div>
					) : (
						<UserGroupMembershipsTable memberships={memberships} />
					)}
				</CardContent>
			</Card>
		</Container>
	)
}
