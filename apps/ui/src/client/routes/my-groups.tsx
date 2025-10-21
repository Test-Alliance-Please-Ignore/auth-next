import { useNavigate } from 'react-router-dom'
import { Users, Crown, Shield } from 'lucide-react'

import { MyGroupsCard } from '@/components/my-groups-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useUserMemberships } from '@/hooks/useGroups'

export default function MyGroupsPage() {
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
		<div className="space-y-6">
			{/* Page Header */}
			<div>
				<h1 className="text-4xl md:text-5xl font-bold gradient-text">My Groups</h1>
				<p className="text-muted-foreground mt-2">Manage your group memberships</p>
			</div>

			{/* Stats */}
			<div className="grid gap-4 md:grid-cols-3">
				<Card className="glow">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Total Groups</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{memberships?.length || 0}</div>
					</CardContent>
				</Card>

				<Card className="glow">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Owned</CardTitle>
						<Crown className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{ownedGroups.length}</div>
					</CardContent>
				</Card>

				<Card className="glow">
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
				<Card className="glow">
					<CardHeader>
						<CardTitle>Owned Groups</CardTitle>
						<CardDescription>Groups you created and manage</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{ownedGroups.map((membership) => (
							<MyGroupsCard
								key={membership.groupId}
								membership={membership}
								onClick={() => navigate(`/admin/groups/${membership.groupId}`)}
							/>
						))}
					</CardContent>
				</Card>
			)}

			{/* Admin Groups */}
			{adminGroups.length > 0 && (
				<Card className="glow">
					<CardHeader>
						<CardTitle>Admin Roles</CardTitle>
						<CardDescription>Groups where you are an administrator</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{adminGroups.map((membership) => (
							<MyGroupsCard
								key={membership.groupId}
								membership={membership}
								onClick={() => navigate(`/groups/${membership.groupId}`)}
							/>
						))}
					</CardContent>
				</Card>
			)}

			{/* Member Groups */}
			{memberGroups.length > 0 && (
				<Card className="glow">
					<CardHeader>
						<CardTitle>Member Groups</CardTitle>
						<CardDescription>Groups you are a member of</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{memberGroups.map((membership) => (
							<MyGroupsCard
								key={membership.groupId}
								membership={membership}
								onClick={() => navigate(`/groups/${membership.groupId}`)}
							/>
						))}
					</CardContent>
				</Card>
			)}

			{/* Empty State */}
			{memberships?.length === 0 && (
				<Card className="glow">
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
		</div>
	)
}
