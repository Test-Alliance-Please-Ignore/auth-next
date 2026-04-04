import { ArrowLeft, Edit2, Globe, Lock, Plus, Trash2, User, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '../../../components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs'
import { useAuth } from '../../../hooks/useAuth'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { CharacterMasteryGrid } from '../components/character-mastery-grid'
import {
	useDeleteSkillPlan,
	usePlanSkills,
	useRemoveSkillFromPlan,
	useSkillPlan,
	useUpdateSkillLevels,
	useUpdateSkillPlan,
} from '../hooks'

export default function SkillPlanDetail() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()

	const { data: plan, isLoading: planLoading } = useSkillPlan(id!)
	const { data: skills, isLoading: skillsLoading } = usePlanSkills(id!)
	const deletePlan = useDeleteSkillPlan()
	const updatePlan = useUpdateSkillPlan()
	const removeSkill = useRemoveSkillFromPlan()

	const [activeTab, setActiveTab] = useState('overview')

	usePageTitle(plan?.name || 'Skill Plan')

	if (!id) {
		return <Navigate to="/skill-plans" replace />
	}

	if (planLoading || skillsLoading) {
		return <LoadingPage />
	}

	if (!plan) {
		return <Navigate to="/skill-plans" replace />
	}

	const handleDelete = async () => {
		if (confirm('Are you sure you want to delete this skill plan?')) {
			try {
				await deletePlan.mutateAsync(id)
				navigate('/skill-plans')
			} catch (error) {
				console.error('Failed to delete plan:', error)
			}
		}
	}

	const handlePublish = async () => {
		try {
			await updatePlan.mutateAsync({
				planId: id,
				data: { isPublished: !plan.isPublished },
			})
		} catch (error) {
			console.error('Failed to update plan:', error)
		}
	}

	const handleRemoveSkill = async (skillId: string) => {
		if (confirm('Are you sure you want to remove this skill from the plan?')) {
			try {
				await removeSkill.mutateAsync({ planId: id, skillId })
			} catch (error) {
				console.error('Failed to remove skill:', error)
			}
		}
	}

	const getMaintainerIcon = () => {
		if (!plan.maintainerId) return <Lock className="h-4 w-4" />
		return plan.maintainerType === 'group' ? (
			<Users className="h-4 w-4" />
		) : (
			<User className="h-4 w-4" />
		)
	}

	return (
		<Container>
			<PageHeader title={plan.name} description={plan.description} />

			{/* Plan status badge */}
			<div className="mb-6">
				<Badge variant={plan.isPublished ? 'default' : 'secondary'}>
					{plan.isPublished ? 'Published' : 'Draft'}
				</Badge>
			</div>

			<Section>
				{/* Action buttons */}
				<div className="flex justify-between items-center mb-6">
					<Button variant="ghost" asChild>
						<Link to="/skill-plans">
							<ArrowLeft className="h-4 w-4 mr-2" />
							Back to Plans
						</Link>
					</Button>

					<div className="flex gap-2">
						{plan.canModify && (
							<>
								<Button variant="ghost" onClick={handlePublish}>
									{plan.isPublished ? (
										<>
											<Lock className="h-4 w-4 mr-2" />
											Unpublish
										</>
									) : (
										<>
											<Globe className="h-4 w-4 mr-2" />
											Publish
										</>
									)}
								</Button>
								<Button variant="ghost" asChild>
									<Link to={`/skill-plans/${id}/edit`}>
										<Edit2 className="h-4 w-4 mr-2" />
										Edit
									</Link>
								</Button>
							</>
						)}
						{plan.canDelete && (
							<Button variant="danger" onClick={handleDelete}>
								<Trash2 className="h-4 w-4 mr-2" />
								Delete
							</Button>
						)}
					</div>
				</div>

				{/* Tabs */}
				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList>
						<TabsTrigger value="overview">Overview</TabsTrigger>
						<TabsTrigger value="skills">Skills ({skills?.length || 0})</TabsTrigger>
					</TabsList>

					{/* Overview Tab */}
					<TabsContent value="overview" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Plan Information</CardTitle>
							</CardHeader>
							<CardContent className="space-y-4">
								{/* Description and Maintainer - side by side on desktop, stacked on mobile */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<h3 className="font-semibold mb-1">Description</h3>
										<p className="text-muted-foreground">{plan.description}</p>
									</div>

									<div>
										<h3 className="font-semibold mb-2">Maintainer</h3>
										<div className="flex items-center gap-2 text-muted-foreground">
											{getMaintainerIcon()}
											<span>{plan.maintainerName || 'System'}</span>
										</div>
									</div>
								</div>

								{plan.categories && plan.categories.length > 0 && (
									<div>
										<h3 className="font-semibold mb-2">Categories</h3>
										<div className="flex flex-wrap gap-2">
											{plan.categories.map((category) => (
												<Badge key={category.id} variant="outline">
													{category.name}
												</Badge>
											))}
										</div>
									</div>
								)}

								<div className="grid grid-cols-2 gap-4 pt-4 border-t">
									<div>
										<p className="text-sm text-muted-foreground">Created</p>
										<p className="font-medium">{new Date(plan.createdAt).toLocaleDateString()}</p>
									</div>
									<div>
										<p className="text-sm text-muted-foreground">Last Updated</p>
										<p className="font-medium">{new Date(plan.updatedAt).toLocaleDateString()}</p>
									</div>
								</div>
							</CardContent>
						</Card>

						{/* Character Readiness - only show if user is logged in */}
						{user && (
							<CharacterMasteryGrid
								planId={id}
								title="Your Characters' Readiness"
								onCharacterClick={(characterId) => {
									// Navigate to detailed progress view for the character
									navigate(`/skill-plans/${id}/progress/character/${characterId}`)
								}}
							/>
						)}
					</TabsContent>

					{/* Skills Tab */}
					<TabsContent value="skills" className="space-y-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between">
								<CardTitle>Plan Skills</CardTitle>
								{plan.canModify && (
									<Button asChild>
										<Link to={`/skill-plans/${id}/edit`}>
											<Plus className="h-4 w-4 mr-2" />
											Manage Skills
										</Link>
									</Button>
								)}
							</CardHeader>
							<CardContent>
								{skills && skills.length > 0 ? (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Skill Name</TableHead>
												<TableHead>Group</TableHead>
												<TableHead className="text-center">Required Level</TableHead>
												<TableHead className="text-center">Recommended Level</TableHead>
												{plan.canModify && <TableHead className="w-[100px]">Actions</TableHead>}
											</TableRow>
										</TableHeader>
										<TableBody>
											{skills.map((skill) => (
												<TableRow key={skill.skillId}>
													<TableCell className="font-medium">
														{skill.skillName || `Unknown Skill (ID: ${skill.skillId})`}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{skill.skillGroup || 'Unknown Group'}
													</TableCell>
													<TableCell className="text-center">{skill.requiredLevel}</TableCell>
													<TableCell className="text-center">{skill.recommendedLevel}</TableCell>
													{plan.canModify && (
														<TableCell>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleRemoveSkill(skill.skillId)}
															>
																Remove
															</Button>
														</TableCell>
													)}
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<div className="text-center py-8 text-muted-foreground">
										<p>No skills have been added to this plan yet.</p>
										{plan.canModify && (
											<Button className="mt-4" asChild>
												<Link to={`/skill-plans/${id}/edit`}>
													<Plus className="h-4 w-4 mr-2" />
													Add First Skill
												</Link>
											</Button>
										)}
									</div>
								)}
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</Section>
		</Container>
	)
}
