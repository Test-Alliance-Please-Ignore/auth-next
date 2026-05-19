import { CheckCircle2, Globe, Lock, Star, XCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '../../../components/ui/badge'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '../../../components/ui/card'

import type { SkillPlan } from '../types'
import type { CharacterReadinessSummary } from '../utils/readiness'

interface SkillPlanCardProps {
	plan: SkillPlan
	characterReadiness?: CharacterReadinessSummary
	isReadinessLoading?: boolean
	hasNoSkills?: boolean
	showPublicationState?: boolean
	readinessIndicator?: 'recommended' | 'required' | 'incomplete'
}

export function SkillPlanCard({
	plan,
	characterReadiness,
	isReadinessLoading = false,
	hasNoSkills = false,
	showPublicationState = true,
	readinessIndicator,
}: SkillPlanCardProps) {
	const navigate = useNavigate()

	const handleCardClick = (e: React.MouseEvent) => {
		// Don't navigate if clicking on a button or link inside the card
		const target = e.target as HTMLElement
		if (target.closest('button') || target.closest('a') || target.closest('[role="button"]')) {
			return
		}
		navigate(`/skill-plans/${plan.id}`)
	}

	const renderReadinessIndicator = () => {
		if (readinessIndicator === 'recommended') {
			return <Star className="h-4 w-4 shrink-0 mt-1 text-amber-400 fill-amber-400" />
		}
		if (readinessIndicator === 'required') {
			return <CheckCircle2 className="h-4 w-4 shrink-0 mt-1 text-green-400" />
		}
		if (readinessIndicator === 'incomplete') {
			return <XCircle className="h-4 w-4 shrink-0 mt-1 text-red-400" />
		}
		return null
	}

	return (
		<Card
			className="flex h-full flex-col hover:shadow-lg transition-shadow cursor-pointer"
			onClick={handleCardClick}
		>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1 flex-1">
						<CardTitle className="text-lg">
							<Link to={`/skill-plans/${plan.id}`} className="hover:text-primary transition-colors">
								<span className="inline-grid grid-cols-[auto_1fr] items-start gap-2">
									{renderReadinessIndicator()}
									<span className="leading-tight">{plan.name}</span>
								</span>
							</Link>
						</CardTitle>
						<CardDescription className="line-clamp-2">{plan.description}</CardDescription>
					</div>
					{showPublicationState ? (
						<div className="flex items-center">
							<Badge
								variant={plan.isPublished ? 'default' : 'secondary'}
								icon={plan.isPublished ? Globe : Lock}
								className="gap-1.5"
							>
								{plan.isPublished ? 'Published' : 'Draft'}
							</Badge>
						</div>
					) : null}
				</div>
			</CardHeader>

			<CardContent className="flex flex-1 flex-col">
				{/* Skills count */}
				{plan.skills && (
					<div className="text-sm font-medium text-muted-foreground">
						{plan.skills.length} skill{plan.skills.length !== 1 ? 's' : ''} in this plan
					</div>
				)}

				{isReadinessLoading ? (
					<div className="mt-auto pt-3">
						<Badge variant="secondary">Checking readiness...</Badge>
					</div>
				) : hasNoSkills ? (
					<div className="mt-auto pt-3">
						<Badge variant="secondary">No Skills</Badge>
					</div>
				) : characterReadiness && characterReadiness.total > 0 ? (
					<div className="mt-auto pt-3 space-y-2">
						<div className="flex items-center gap-2 text-xs text-muted-foreground">
							<span>Character Readiness</span>
							<span className="font-semibold text-foreground">{characterReadiness.total}</span>
							<span>characters</span>
						</div>
						<div className="flex flex-wrap items-center gap-2 text-xs">
							{characterReadiness.completed > 0 && (
								<Badge variant="gold" className="gap-1 px-2 py-0">
									<Star className="h-3 w-3 fill-current" />
									Fully Trained <span className="font-bold">{characterReadiness.completed}</span>
								</Badge>
							)}
							{characterReadiness.meetsRequirements > 0 && (
								<Badge variant="success" className="gap-1 px-2 py-0">
									<CheckCircle2 className="h-3 w-3" />
									Meets Required{' '}
									<span className="font-bold">{characterReadiness.meetsRequirements}</span>
								</Badge>
							)}
							{characterReadiness.incomplete > 0 && (
								<Badge variant="destructive" className="gap-1 px-2 py-0">
									<XCircle className="h-3 w-3" />
									Needs Training <span className="font-bold">{characterReadiness.incomplete}</span>
								</Badge>
							)}
						</div>
					</div>
				) : (
					<div className="mt-auto pt-3">
						<Badge variant="secondary">No character data</Badge>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
