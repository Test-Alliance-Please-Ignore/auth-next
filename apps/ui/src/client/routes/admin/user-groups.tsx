import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { UserGroupMembershipsTable } from '@/components/user-group-memberships-table'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { Button } from '@/components/ui/button'

const grantSourceVariantBySource = {
	global: 'default',
	group_scoped: 'ghost',
} as const

const grantTargetVariantByType = {
	all_members: 'success',
	all_admins: 'warning',
	owner_only: 'default',
	owner_and_admins: 'secondary',
} as const

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
	const permissionGrants = useMemo(
		() =>
			[...((user.permissionGrants ?? []) as typeof user.permissionGrants)].sort((a, b) => {
				const urnDiff = a.urn.localeCompare(b.urn)
				if (urnDiff !== 0) return urnDiff
				const sourceDiff = a.source.localeCompare(b.source)
				if (sourceDiff !== 0) return sourceDiff
				return a.groupName.localeCompare(b.groupName)
			}),
		[user.permissionGrants]
	)

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

			<Card>
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

			<Card>
				<CardHeader>
					<CardTitle>Resolved Permission Grants</CardTitle>
					<CardDescription>
						URNs currently resolved for this user, including the group or corporation that
						granted each one.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{permissionGrants.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">No resolved permissions</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>URN</TableHead>
									<TableHead>Grant Source</TableHead>
									<TableHead>Target</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{permissionGrants.map((grant) => (
									<TableRow key={`${grant.urn}:${grant.groupId}:${grant.source}`}>
										<TableCell>
											<div className="space-y-1">
												<div className="font-medium">{grant.name}</div>
												<code className="block font-mono text-sm font-semibold text-muted-foreground">
													{grant.urn}
												</code>
												{grant.description && (
													<div className="text-xs text-muted-foreground">{grant.description}</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<div className="space-y-1">
												<div className="font-medium">{grant.groupName}</div>
												<div className="text-xs text-muted-foreground">{grant.groupId}</div>
												<div>
													<Badge
														variant={grantSourceVariantBySource[grant.source]}
														className="text-[10px] uppercase"
													>
														{grant.source === 'global' ? 'global' : 'group scoped'}
													</Badge>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={grantTargetVariantByType[grant.targetType]} className="capitalize">
												{grant.targetType.replaceAll('_', ' ')}
											</Badge>
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
