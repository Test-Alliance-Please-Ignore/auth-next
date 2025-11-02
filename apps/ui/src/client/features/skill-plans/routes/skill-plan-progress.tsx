import { useParams, Navigate, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { useSkillPlan } from '../hooks'
import { ProgressChecker } from '../components/progress-checker'
import { Button } from '../../../components/ui/button'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'

export default function SkillPlanProgress() {
	const { id } = useParams<{ id: string }>()
	const [searchParams] = useSearchParams()
	const characterId = searchParams.get('characterId') || undefined
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
			<div className="mb-4">
				<Button variant="ghost" size="sm" asChild>
					<Link to={`/skill-plans/${id}`}>
						<ArrowLeft className="h-4 w-4 mr-2" />
						Back to Plan
					</Link>
				</Button>
			</div>

			<PageHeader
				title={`Progress Check: ${plan.name}`}
			/>

			<Section className="mt-8">
				<ProgressChecker planId={id} planName={plan.name} initialCharacterId={characterId} />
			</Section>
		</Container>
	)
}