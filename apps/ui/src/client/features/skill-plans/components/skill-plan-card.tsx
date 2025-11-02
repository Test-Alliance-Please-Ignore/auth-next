import { Link } from 'react-router-dom'
import { Edit2, Eye, Trash2, Users, User, Lock, Globe, Copy } from 'lucide-react'
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '../../../components/ui/card'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import type { SkillPlan } from '../types'

interface SkillPlanCardProps {
	plan: SkillPlan
	onDelete?: (planId: string) => void
	onClone?: (planId: string) => void
}

export function SkillPlanCard({ plan, onDelete, onClone }: SkillPlanCardProps) {
	const getMaintainerIcon = () => {
		if (!plan.maintainerId) return <Lock className="h-3 w-3" />
		return plan.maintainerType === 'group' ? (
			<Users className="h-3 w-3" />
		) : (
			<User className="h-3 w-3" />
		)
	}

	const getStatusIcon = () => {
		return plan.isPublished ? (
			<Globe className="h-3 w-3 text-green-500" />
		) : (
			<Lock className="h-3 w-3 text-muted-foreground" />
		)
	}

	return (
		<Card className="hover:shadow-lg transition-shadow" variant="interactive">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1 flex-1">
						<CardTitle className="text-lg">
							<Link
								to={`/skill-plans/${plan.id}`}
								className="hover:text-primary transition-colors"
							>
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

			<CardContent className="space-y-3">
				{/* Maintainer info */}
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					{getMaintainerIcon()}
					<span>{plan.maintainerName || 'System'}</span>
				</div>

				{/* Categories */}
				{plan.categories && plan.categories.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{plan.categories.map((category) => (
							<Badge key={category.id} variant="outline" className="text-xs">
								{category.name}
							</Badge>
						))}
					</div>
				)}

				{/* Skills count */}
				{plan.skills && (
					<div className="text-sm text-muted-foreground">
						{plan.skills.length} skill{plan.skills.length !== 1 ? 's' : ''} in this plan
					</div>
				)}

				{/* Timestamps */}
				<div className="flex items-center gap-4 text-xs text-muted-foreground">
					<span>Created: {new Date(plan.createdAt).toLocaleDateString()}</span>
					{plan.updatedAt !== plan.createdAt && (
						<span>Updated: {new Date(plan.updatedAt).toLocaleDateString()}</span>
					)}
				</div>
			</CardContent>

			<CardFooter className="flex justify-between">
				<div className="flex gap-2">
					<Button variant="ghost" size="sm" asChild>
						<Link to={`/skill-plans/${plan.id}`}>
							<Eye className="h-4 w-4 mr-1" />
							View
						</Link>
					</Button>
					{plan.canModify && (
						<Button variant="ghost" size="sm" asChild>
							<Link to={`/skill-plans/${plan.id}/edit`}>
								<Edit2 className="h-4 w-4 mr-1" />
								Edit
							</Link>
						</Button>
					)}
				</div>
				<div className="flex gap-2">
					{onClone && (
						<Button variant="ghost" size="sm" onClick={() => onClone(plan.id)}>
							<Copy className="h-4 w-4 mr-1" />
							Clone
						</Button>
					)}
					{plan.canDelete && onDelete && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onDelete(plan.id)}
							className="text-destructive hover:text-destructive"
						>
							<Trash2 className="h-4 w-4 mr-1" />
							Delete
						</Button>
					)}
				</div>
			</CardFooter>
		</Card>
	)
}