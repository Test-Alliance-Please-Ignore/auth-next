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

import type { SkillPlan } from '../types'
import type { CharacterReadinessSummary } from '../utils/readiness'

interface SkillPlanCardProps {
	plan: SkillPlan
	characterReadiness?: CharacterReadinessSummary
	isReadinessLoading?: boolean
	hasNoSkills?: boolean
}

export function SkillPlanCard({
	plan,
	characterReadiness,
	isReadinessLoading = false,
	hasNoSkills = false,
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
				) : hasNoSkills ? (
					<div className="mt-auto pt-3">
						<Badge variant="secondary">No Skills</Badge>
					</div>
				) : characterReadiness && characterReadiness.total > 0 ? (
					<div className="mt-auto pt-3 space-y-2">
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							<span>Character Readiness</span>
							<span>{characterReadiness.total} characters</span>
						</div>
						<div className="flex flex-wrap items-center gap-2 text-xs">
							{characterReadiness.completed > 0 && (
								<Badge variant="success" className="px-2 py-0">
									Completed {characterReadiness.completed}
								</Badge>
							)}
							{characterReadiness.meetsRequirements > 0 && (
								<Badge variant="warning" className="px-2 py-0">
									Meets Required {characterReadiness.meetsRequirements}
								</Badge>
							)}
							{characterReadiness.incomplete > 0 && (
								<Badge variant="destructive" className="px-2 py-0">
									Incomplete {characterReadiness.incomplete}
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
