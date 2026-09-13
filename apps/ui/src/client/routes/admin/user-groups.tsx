import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { UserGroupMembershipsTable } from '@/components/user-group-memberships-table'
import { useAdminUser } from '@/hooks/useAdminUsers'
import { usePageTitle } from '@/hooks/usePageTitle'
import { compareLocaleStrings, useAppTranslation } from '@/i18n'

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
	const { t, locale } = useAppTranslation()
	usePageTitle(t('admin.users.userGroups.pageTitle'))
	const { userId } = useParams<{ userId: string }>()
	const navigate = useNavigate()
	const { data: user, isLoading } = useAdminUser(userId!)
	const memberships = user?.groupMemberships ?? []
	const rawPermissionGrants = user?.permissionGrants ?? []
	const permissionGrants = useMemo(
		() =>
			[...rawPermissionGrants].sort((a, b) => {
				const urnDiff = a.urn.localeCompare(b.urn)
				if (urnDiff !== 0) return urnDiff
				const sourceDiff = a.source.localeCompare(b.source)
				if (sourceDiff !== 0) return sourceDiff
				return compareLocaleStrings(a.groupName, b.groupName)
			}),
		[rawPermissionGrants, locale]
	)

	if (isLoading) {
		return (
			<div className="text-center py-8 text-muted-foreground">
				{t('admin.users.userGroups.loading')}
			</div>
		)
	}

	if (!user) {
		return (
			<div className="text-center py-8 text-muted-foreground">
				{t('admin.users.account.notFound')}
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-4">
				<Button variant="ghost" onClick={() => navigate(`/admin/users/${userId}`)}>
					<ArrowLeft className="h-4 w-4" />
					{t('admin.users.account.backToUser')}
				</Button>
			</div>

			<div className="space-y-1">
				<h1 className="text-3xl font-bold gradient-text">{t('admin.users.userGroups.title')}</h1>
				<p className="text-muted-foreground">
					{t('admin.users.userGroups.description', {
						name:
							user.characters.find((c) => c.is_primary)?.characterName ||
							t('admin.users.account.user'),
						count: memberships.length,
					})}
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t('admin.users.userGroups.memberships')}</CardTitle>
					<CardDescription>{t('admin.users.userGroups.membershipsDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					{memberships.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.users.userGroups.empty')}
						</div>
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
					<CardTitle>{t('admin.users.userGroups.grants')}</CardTitle>
					<CardDescription>{t('admin.users.userGroups.grantsDescription')}</CardDescription>
				</CardHeader>
				<CardContent>
					{permissionGrants.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							{t('admin.users.userGroups.noPermissions')}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t('admin.fields.urn')}</TableHead>
									<TableHead>{t('admin.users.userGroups.source')}</TableHead>
									<TableHead>{t('admin.users.userGroups.target')}</TableHead>
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
														{grant.source === 'global'
															? t('admin.users.userGroups.global')
															: t('admin.users.userGroups.groupScoped')}
													</Badge>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<Badge
												variant={grantTargetVariantByType[grant.targetType]}
												className="capitalize"
											>
												{t(`groups.permissions.targets.${grant.targetType}`)}
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
