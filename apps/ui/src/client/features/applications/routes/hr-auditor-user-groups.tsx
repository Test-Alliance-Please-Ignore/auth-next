import { ArrowLeft } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { UserGroupMembershipsTable } from '@/components/user-group-memberships-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { useAuditorUser } from '@/hooks/useAuditorUsers'

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
		return <div className="text-center py-8 text-muted-foreground">Loading user group memberships...</div>
	}

	if (!targetUser) {
		return <div className="text-center py-8 text-muted-foreground">User not found</div>
	}

	const memberships = targetUser.groupMemberships ?? []
	const mainCharacterName =
		targetUser.characters.find((c) => c.is_primary)?.characterName ?? 'User'

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(`/hr/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4" />
					Back to User
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">User Group Memberships</h1>
				<p className="text-muted-foreground">
					{mainCharacterName} belongs to {memberships.length} group{memberships.length === 1 ? '' : 's'}.
				</p>
			</div>

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
		</div>
	)
}
