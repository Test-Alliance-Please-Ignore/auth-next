import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'

import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import { useAuth } from '../../../hooks/useAuth'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { useUserPermissions } from '../../../hooks/useUserPermissions'
import { SkillPlanForm } from '../components/skill-plan-form'
import { useCreateSkillPlan } from '../hooks'

import type { CreateSkillPlanRequest, UpdateSkillPlanRequest } from '../types'

export default function SkillPlanCreate() {
	usePageTitle('Create Skill Plan')

	const navigate = useNavigate()
	const { user, isAuthenticated, isLoading: authLoading } = useAuth()
	const { hasPermission } = useUserPermissions()
	const createPlan = useCreateSkillPlan()
	const canCreatePlans = user?.is_admin || hasPermission('urn:skill-plans:create')

	// Redirect if not authenticated
	if (!authLoading && !isAuthenticated) {
		return <Navigate to="/skill-plans" replace />
	}

	if (!authLoading && !canCreatePlans) {
		return <Navigate to="/skill-plans" replace />
	}

	const handleSubmit = async (data: CreateSkillPlanRequest | UpdateSkillPlanRequest) => {
		try {
			const newPlan = await createPlan.mutateAsync(data as CreateSkillPlanRequest)
			// Navigate to the new plan's detail page
			void navigate(`/skill-plans/${newPlan.id}`)
		} catch (error) {
			console.error('Failed to create plan:', error)
			// In a real app, show a toast notification
		}
	}

	const handleCancel = () => {
		void navigate('/skill-plans')
	}

	if (authLoading) {
		return <LoadingPage />
	}

	return (
		<Container>
			<PageHeader
				title="Create Skill Plan"
				description="Create a new skill training plan for EVE Online"
				action={
					<Button variant="ghost" size="sm" asChild>
						<Link to="/skill-plans">
							<ArrowLeft className="h-4 w-4" />
							Back to Plans
						</Link>
					</Button>
				}
			/>

			<Section>
				<Card>
					<CardHeader>
						<CardTitle>Plan Details</CardTitle>
					</CardHeader>
					<CardContent>
						<SkillPlanForm
							onSubmit={handleSubmit}
							onCancel={handleCancel}
							isSubmitting={createPlan.isPending}
							mode="create"
						/>
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
