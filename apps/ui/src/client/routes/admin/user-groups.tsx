import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'

import { UserGroupMembershipsTable } from '@/components/user-group-memberships-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Button } from '@/components/ui/button'

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
				<Button variant="ghost" onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4" />
					Back to User
				</Button>
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
						<UserGroupMembershipsTable
							memberships={memberships}
							getGroupPath={(groupId) => `/admin/groups/${groupId}`}
						/>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
