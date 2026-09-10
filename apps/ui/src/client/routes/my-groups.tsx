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
import { formatNumber, useAppTranslation } from '@/i18n'

export default function MyGroupsPage() {
	const { t } = useAppTranslation()
	usePageTitle(t('myGroups.title'))
	const navigate = useNavigate()
	const { data: memberships, isLoading } = useUserMemberships()

	if (isLoading) {
		return (
			<div className="flex items-center justify-center min-h-[400px]">
				<p className="text-muted-foreground">{t('myGroups.loading')}</p>
			</div>
		)
	}

	const ownedGroups = memberships?.filter((m) => m.isOwner) || []
	const adminGroups = memberships?.filter((m) => m.isAdmin && !m.isOwner) || []
	const memberGroups = memberships?.filter((m) => !m.isOwner && !m.isAdmin) || []

	return (
		<Container>
			<PageHeader title={t('myGroups.title')} description={t('myGroups.description')} />

			<Section>
				{/* Stats */}
				<div className="grid gap-4 md:grid-cols-3">
					<Card variant="default">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">{t('myGroups.total')}</CardTitle>
							<Users className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{formatNumber(memberships?.length || 0)}</div>
						</CardContent>
					</Card>

					<Card variant="default">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">{t('myGroups.owned')}</CardTitle>
							<Crown className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{formatNumber(ownedGroups.length)}</div>
						</CardContent>
					</Card>

					<Card variant="default">
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<CardTitle className="text-sm font-medium">{t('myGroups.adminRoles')}</CardTitle>
							<Shield className="h-4 w-4 text-muted-foreground" />
						</CardHeader>
						<CardContent>
							<div className="text-2xl font-bold">{formatNumber(adminGroups.length)}</div>
						</CardContent>
					</Card>
				</div>

				{/* Owned Groups */}
				{ownedGroups.length > 0 && (
					<MyGroupsTable
						title={t('myGroups.ownedGroups')}
						description={t('myGroups.ownedDescription')}
						memberships={ownedGroups}
						showActions={false}
					/>
				)}

				{/* Admin Groups */}
				{adminGroups.length > 0 && (
					<MyGroupsTable
						title={t('myGroups.adminRoles')}
						description={t('myGroups.adminDescription')}
						memberships={adminGroups}
					/>
				)}

				{/* Member Groups */}
				{memberGroups.length > 0 && (
					<MyGroupsTable
						title={t('myGroups.memberGroups')}
						description={t('myGroups.memberDescription')}
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
							<h3 className="text-xl font-semibold mb-2">{t('myGroups.emptyHeading')}</h3>
							<p className="text-muted-foreground mb-6 max-w-md mx-auto">
								{t('myGroups.emptyDescription')}
							</p>
							<Button onClick={() => navigate('/groups')} size="lg">
								{t('myGroups.browse')}
							</Button>
						</CardContent>
					</Card>
				)}
			</Section>
		</Container>
	)
}
