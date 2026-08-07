import { Plus, Settings } from 'lucide-react'
import { useMemo } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import { useAuth } from '../../../hooks/useAuth'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { useUserPermissions } from '../../../hooks/useUserPermissions'
import { CategorySectionHeader } from '../components/category-section-header'
import { SkillPlanCard } from '../components/skill-plan-card'
import { useMySkillPlans } from '../hooks'
import { groupPlansByCategory } from '../utils/group-by-category'

export default function MySkillPlans() {
	usePageTitle('My Skill Plans')

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasPermission } = useUserPermissions()
	const { data: plansResponse, isLoading } = useMySkillPlans()
	const canCreatePlans = !!user && (user.is_admin || hasPermission('urn:skill-plans:create'))
	const canManageCategories =
		!!user &&
		(user.is_admin ||
			hasPermission('urn:skill-plans:categories:create') ||
			hasPermission('urn:skill-plans:categories:manage'))
	const canEditSkillPlans =
		!!user && (canCreatePlans || canManageCategories || hasPermission('urn:skill-plans:manage-all'))

	// Redirect if not authenticated
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/skill-plans" replace />
	}
	if (!authLoading && isAuthenticated && !canEditSkillPlans) {
		return <Navigate to="/skill-plans" replace />
	}

	// Extract plans from paginated response
	const plans = plansResponse?.items || []
	const totalPlans = plansResponse?.total || 0

	// Group plans by category
	const groupedPlans = useMemo(() => {
		return groupPlansByCategory(plans)
	}, [plans])

	if (isLoading || authLoading) {
		return <LoadingPage />
	}

	return (
		<Container>
			<PageHeader title="My Skill Plans" description="Manage your skill training plans" />

			<Section>
				{/* Actions bar */}
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-semibold">Your Plans ({totalPlans})</h2>
					<div className="flex gap-2">
						{canManageCategories && (
							<Button variant="ghost" asChild>
								<Link to="/skill-plans/categories/manage">
									<Settings className="h-4 w-4" />
									Manage Categories
								</Link>
							</Button>
						)}
						<Button variant="ghost" asChild>
							<Link to="/skill-plans">Browse All Plans</Link>
						</Button>
						{canCreatePlans && (
							<Button asChild>
								<Link to="/skill-plans/create">
									<Plus className="h-4 w-4" />
									Create New Plan
								</Link>
							</Button>
						)}
					</div>
				</div>

				{/* Plans list */}
				{plans && plans.length > 0 ? (
					<div className="space-y-6">
						{groupedPlans.map((group) => (
							<div key={group.category?.id || 'uncategorized'}>
								<CategorySectionHeader name={group.category?.name || 'Uncategorized'} />
								<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
									{group.plans.map((plan) => (
										<SkillPlanCard
											key={`${group.category?.id || 'uncategorized'}-${plan.id}`}
											plan={plan}
											showPublicationState={canEditSkillPlans}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				) : (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-muted-foreground mb-4">You haven't created any skill plans yet.</p>
							{canCreatePlans && (
								<Button asChild>
									<Link to="/skill-plans/create">
										<Plus className="h-4 w-4" />
										Create Your First Plan
									</Link>
								</Button>
							)}
						</CardContent>
					</Card>
				)}
			</Section>
		</Container>
	)
}
