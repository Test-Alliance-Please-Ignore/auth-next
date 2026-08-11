import { Crown, Shield, Users } from 'lucide-react'
import { useNavigate } from 'react-router'

import { MyGroupsTable } from '@/components/my-groups-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useUserMemberships } from '@/hooks/useGroups'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function MyGroupsPage() {
	usePageTitle('My Groups')
	const navigate = useNavigate()
	const { data: memberships, isLoading } = useUserMemberships()

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">Loading your groups...</p>
			</div>
		)
	}

	const ownedGroups = memberships?.filter((m) => m.isOwner) || []
	const adminGroups = memberships?.filter((m) => m.isAdmin && !m.isOwner) || []
	const memberGroups = memberships?.filter((m) => !m.isOwner && !m.isAdmin) || []

	return (
		<Container>
			<PageHeader title="My Groups" description="Manage your group memberships" />

			<Section>
				{/* Stats */}
				<div className="grid gap-4 md:grid-cols-3">
					<Card variant="default">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Total Groups</CardTitle>
							<Users className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{memberships?.length || 0}</div>
						</CardContent>
					</Card>

					<Card variant="default">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Owned</CardTitle>
							<Crown className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{ownedGroups.length}</div>
						</CardContent>
					</Card>

					<Card variant="default">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">Admin Roles</CardTitle>
							<Shield className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{adminGroups.length}</div>
						</CardContent>
					</Card>
				</div>

				{/* Owned Groups */}
				{ownedGroups.length > 0 && (
					<MyGroupsTable
						title="Owned Groups"
						description="Groups you created and manage"
						memberships={ownedGroups}
						showActions={false}
					/>
				)}

				{/* Admin Groups */}
				{adminGroups.length > 0 && (
					<MyGroupsTable
						title="Admin Roles"
						description="Groups where you are an administrator"
						memberships={adminGroups}
					/>
				)}

				{/* Member Groups */}
				{memberGroups.length > 0 && (
					<MyGroupsTable
						title="Member Groups"
						description="Groups you are a member of"
						memberships={memberGroups}
					/>
				)}

				{/* Empty State */}
				{memberships?.length === 0 && (
					<Card variant="default">
						<CardContent className="py-16 text-center">
							<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
								<Users className="h-10 w-10 text-muted-foreground" />
							</div>
							<h3 className="text-xl font-semibold mb-2">No Groups Yet</h3>
							<p className="text-muted-foreground mb-6 max-w-md mx-auto">
								You haven't joined any groups yet. Browse available groups to connect with other EVE
								Online players and participate in activities.
							</p>
							<Button onClick={() => navigate('/groups')} size="lg">
								Browse Available Groups
							</Button>
						</CardContent>
					</Card>
				)}
			</Section>
		</Container>
	)
}
