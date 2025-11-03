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

interface SkillPlanCardProps {
	plan: SkillPlan
}

export function SkillPlanCard({ plan }: SkillPlanCardProps) {
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
			className="hover:shadow-lg transition-shadow cursor-pointer"
			variant="interactive"
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

			<CardContent>
				{/* Skills count */}
				{plan.skills && (
					<div className="text-sm text-muted-foreground">
						{plan.skills.length} skill{plan.skills.length !== 1 ? 's' : ''} in this plan
					</div>
				)}
			</CardContent>
		</Card>
	)
}
