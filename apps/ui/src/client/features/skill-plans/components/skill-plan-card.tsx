import { Globe, Lock } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '../../../components/ui/badge'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '../../../components/ui/card'
import { Progress } from '../../../components/ui/progress'
import { deriveReadinessStatus } from '../utils/readiness'

import type { SkillPlan } from '../types'

interface SkillPlanCardProps {
	plan: SkillPlan
	readiness?: {
		percentageRequired: number
		percentageRecommended: number
		totalSkills: number
	}
	isReadinessLoading?: boolean
}

export function SkillPlanCard({
	plan,
	readiness,
	isReadinessLoading = false,
}: SkillPlanCardProps) {
	const navigate = useNavigate()

	const getStatusIcon = () => {
		return plan.isPublished ? (
			<Globe className="h-3 w-3 text-green-500" />
		) : (
			<Lock className="h-3 w-3 text-muted-foreground" />
		)
	}

	const handleCardClick = (e: React.MouseEvent) => {
		// Don't navigate if clicking on a button or link inside the card
		const target = e.target as HTMLElement
		if (target.closest('button') || target.closest('a') || target.closest('[role="button"]')) {
			return
		}
		navigate(`/skill-plans/${plan.id}`)
	}

	const getReadinessDisplay = () => {
		if (!readiness) return null
		const status = deriveReadinessStatus(readiness)
		switch (status) {
			case 'completed':
				return {
					label: 'Completed',
					variant: 'success' as const,
				}
			case 'meets_requirements':
				return {
					label: 'Meets Requirements',
					variant: 'warning' as const,
				}
			case 'no_skills':
				return {
					label: 'No Skills',
					variant: 'secondary' as const,
				}
			case 'incomplete':
			default:
				return {
					label: 'Incomplete',
					variant: 'destructive' as const,
				}
		}
	}

	const readinessDisplay = getReadinessDisplay()

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
								{plan.name}
							</Link>
						</CardTitle>
						<CardDescription className="line-clamp-2">{plan.description}</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						{getStatusIcon()}
						<Badge variant={plan.isPublished ? 'default' : 'secondary'}>
							{plan.isPublished ? 'Published' : 'Draft'}
						</Badge>
					</div>
				</div>
			</CardHeader>

			<CardContent className="flex flex-1 flex-col">
				{/* Skills count */}
				{plan.skills && (
					<div className="text-sm text-muted-foreground">
						{plan.skills.length} skill{plan.skills.length !== 1 ? 's' : ''} in this plan
					</div>
				)}

				{isReadinessLoading ? (
					<div className="mt-auto pt-3">
						<Badge variant="secondary">Checking readiness...</Badge>
					</div>
				) : readiness && readinessDisplay ? (
					<div className="mt-auto pt-3 space-y-2">
						<div className="flex items-center gap-2">
							<Badge variant={readinessDisplay.variant}>{readinessDisplay.label}</Badge>
						</div>
						<div className="space-y-1.5">
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>Required</span>
								<span>{Math.round(readiness.percentageRequired)}%</span>
							</div>
							<Progress
								value={readiness.percentageRequired}
								className="h-1.5 bg-warning [&>div]:bg-primary"
							/>
						</div>
						<div className="space-y-1.5">
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>Recommended</span>
								<span>{Math.round(readiness.percentageRecommended)}%</span>
							</div>
							<Progress
								value={readiness.percentageRecommended}
								className="h-1.5 bg-warning [&>div]:bg-primary"
							/>
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
