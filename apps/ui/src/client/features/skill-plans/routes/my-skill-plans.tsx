import { Link, Navigate } from 'react-router-dom'
import { Plus, Settings } from 'lucide-react'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { useAuth } from '../../../hooks/useAuth'
import { useMySkillPlans, useDeleteSkillPlan } from '../hooks'
import { SkillPlanCard } from '../components/skill-plan-card'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'

export default function MySkillPlans() {
	usePageTitle('My Skill Plans')

	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { data: plans, isLoading } = useMySkillPlans()
	const deletePlan = useDeleteSkillPlan()

	// Redirect if not authenticated
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/skill-plans" replace />
	}

	const handleDelete = async (planId: string) => {
		if (confirm('Are you sure you want to delete this skill plan?')) {
			try {
				await deletePlan.mutateAsync(planId)
			} catch (error) {
				console.error('Failed to delete plan:', error)
			}
		}
	}

	const handleClone = (planId: string) => {
		// TODO: Implement clone functionality
		console.log('Clone plan:', planId)
	}

	if (isLoading || authLoading) {
		return <LoadingPage />
	}

	return (
		<Container>
			<PageHeader
				title="My Skill Plans"
				description="Manage your skill training plans"
			/>

			<Section>
				{/* Actions bar */}
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-semibold">
						Your Plans ({plans?.length || 0})
					</h2>
					<div className="flex gap-2">
						{user?.is_admin && (
							<Button variant="outline" asChild>
								<Link to="/skill-plans/categories/manage">
									<Settings className="h-4 w-4 mr-2" />
									Manage Categories
								</Link>
							</Button>
						)}
						<Button variant="outline" asChild>
							<Link to="/skill-plans">Browse All Plans</Link>
						</Button>
						<Button asChild>
							<Link to="/skill-plans/create">
								<Plus className="h-4 w-4 mr-2" />
								Create New Plan
							</Link>
						</Button>
					</div>
				</div>

				{/* Plans list */}
				{plans && plans.length > 0 ? (
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						{plans.map((plan) => (
							<SkillPlanCard
								key={plan.id}
								plan={plan}
								onDelete={handleDelete}
								onClone={handleClone}
							/>
						))}
					</div>
				) : (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-muted-foreground mb-4">
								You haven't created any skill plans yet.
							</p>
							<Button asChild>
								<Link to="/skill-plans/create">
									<Plus className="h-4 w-4 mr-2" />
									Create Your First Plan
								</Link>
							</Button>
						</CardContent>
					</Card>
				)}
			</Section>
		</Container>
	)
}