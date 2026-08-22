import { ArrowLeft } from 'lucide-react'
import { Link, Navigate, useParams } from 'react-router'

import { Button } from '../../../components/ui/button'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { ProgressChecker } from '../components/progress-checker'
import { useSkillPlan } from '../hooks'

export default function SkillPlanProgress() {
	const { id, characterId } = useParams<{ id: string; characterId?: string }>()
	const { data: plan, isLoading } = useSkillPlan(id!)

	usePageTitle(plan ? `Progress: ${plan.name}` : 'Skill Plan Progress')

	if (!id) {
		return <Navigate to="/skill-plans" replace />
	}

	if (isLoading) {
		return <LoadingPage />
	}

	if (!plan) {
		return <Navigate to="/skill-plans" replace />
	}

	return (
		<Container>
			<PageHeader
				title={`Progress Check: ${plan.name}`}
				action={
					<Button variant="ghost" size="sm" asChild>
						<Link to={`/skill-plans/${id}`}>
							<ArrowLeft className="h-4 w-4" />
							Back to Plan
						</Link>
					</Button>
				}
			/>

			<Section className="mt-8">
				<ProgressChecker planId={id} planName={plan.name} initialCharacterId={characterId} />
			</Section>
		</Container>
	)
}
