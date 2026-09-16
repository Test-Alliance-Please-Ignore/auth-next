import { ArrowLeft, Edit2, Globe, Lock, Plus, Trash2, User, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { getActiveLocale, useAppTranslation } from '@/i18n'

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
	useUpdateSkillPlan,
} from '../hooks'

export default function SkillPlanDetail() {
	const { t } = useAppTranslation()

	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()

	const { data: plan, isLoading: planLoading } = useSkillPlan(id!)
	const { data: skills, isLoading: skillsLoading } = usePlanSkills(id!)
	const deletePlan = useDeleteSkillPlan()
	const updatePlan = useUpdateSkillPlan()
	const removeSkill = useRemoveSkillFromPlan()

	const [activeTab, setActiveTab] = useState('overview')

	usePageTitle(plan?.name || t('skillPlans.skillPlan'))

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
		if (confirm(t('skillPlans.areYouSureYouWantToDeleteThisSkillPlan'))) {
			try {
				await deletePlan.mutateAsync(id)
				void navigate('/skill-plans')
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
		if (confirm(t('skillPlans.areYouSureYouWantToRemoveThisSkillFrom'))) {
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
			<PageHeader
				title={plan.name}
				description={plan.description}
				action={
					<Button variant="ghost" size="sm" asChild>
						<Link to="/skill-plans">
							<ArrowLeft className="h-4 w-4" />
							{t('skillPlans.backToPlans')}
						</Link>
					</Button>
				}
			/>

			<Section>
				{/* Action buttons */}
				<div className="mb-6 flex items-center justify-end">
					<div className="flex gap-2">
						{plan.canModify && (
							<>
								<Button variant="ghost" onClick={handlePublish}>
									{plan.isPublished ? (
										<>
											<Lock className="h-4 w-4" />
											{t('skillPlans.unpublish')}
										</>
									) : (
										<>
											<Globe className="h-4 w-4" />
											{t('skillPlans.publish')}
										</>
									)}
								</Button>
								<Button variant="ghost" asChild>
									<Link to={`/skill-plans/${id}/edit`}>
										<Edit2 className="h-4 w-4" />
										{t('skillPlans.edit')}
									</Link>
								</Button>
							</>
						)}
						{plan.canDelete && (
							<Button variant="destructive" onClick={handleDelete}>
								<Trash2 className="h-4 w-4" />
								{t('skillPlans.delete')}
							</Button>
						)}
					</div>
				</div>

				{/* Tabs */}
				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList>
						<TabsTrigger value="overview">{t('skillPlans.overview')}</TabsTrigger>
						<TabsTrigger value="skills">
							{t('skillPlans.skills')}
							{skills?.length || 0})
						</TabsTrigger>
					</TabsList>

					{/* Overview Tab */}
					<TabsContent value="overview" className="space-y-4">
						<Card>
							<CardHeader>
								<div className="flex items-center justify-between gap-3">
									<CardTitle>{t('skillPlans.planInformation')}</CardTitle>
									<Badge variant={plan.isPublished ? 'default' : 'secondary'}>
										{plan.isPublished ? t('skillPlans.published') : t('skillPlans.draft')}
									</Badge>
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								{/* Description and Maintainer - side by side on desktop, stacked on mobile */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<h3 className="font-semibold mb-1">{t('skillPlans.description')}</h3>
										<p className="text-muted-foreground">{plan.description}</p>
									</div>

									<div>
										<h3 className="font-semibold mb-2">{t('skillPlans.maintainer2')}</h3>
										<div className="flex items-center gap-2 text-muted-foreground">
											{getMaintainerIcon()}
											<span>{plan.maintainerName || t('skillPlans.system')}</span>
										</div>
									</div>
								</div>

								{plan.categories && plan.categories.length > 0 && (
									<div>
										<h3 className="font-semibold mb-2">{t('skillPlans.categories')}</h3>
										<div className="flex flex-wrap gap-2">
											{plan.categories.map((category) => (
												<Badge key={category.id} variant="ghost">
													{category.name}
												</Badge>
											))}
										</div>
									</div>
								)}

								<div className="grid grid-cols-2 gap-4 pt-4 border-t">
									<div>
										<p className="text-sm text-muted-foreground">{t('skillPlans.created')}</p>
										<p className="font-medium">
											{new Date(plan.createdAt).toLocaleDateString(getActiveLocale())}
										</p>
									</div>
									<div>
										<p className="text-sm text-muted-foreground">{t('skillPlans.lastUpdated')}</p>
										<p className="font-medium">
											{new Date(plan.updatedAt).toLocaleDateString(getActiveLocale())}
										</p>
									</div>
								</div>
							</CardContent>
						</Card>

						{/* Character Readiness - only show if user is logged in */}
						{user && (
							<CharacterMasteryGrid
								planId={id}
								title={t('skillPlans.yourCharactersReadiness')}
								onCharacterClick={(characterId) => {
									// Navigate to detailed progress view for the character
									void navigate(`/skill-plans/${id}/progress/character/${characterId}`)
								}}
							/>
						)}
					</TabsContent>

					{/* Skills Tab */}
					<TabsContent value="skills" className="space-y-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between">
								<CardTitle>{t('skillPlans.planSkills')}</CardTitle>
								{plan.canModify && (
									<Button asChild>
										<Link to={`/skill-plans/${id}/edit`}>
											<Plus className="h-4 w-4" />
											{t('skillPlans.manageSkills')}
										</Link>
									</Button>
								)}
							</CardHeader>
							<CardContent>
								{skills && skills.length > 0 ? (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>{t('skillPlans.skillName')}</TableHead>
												<TableHead>{t('skillPlans.group')}</TableHead>
												<TableHead className="text-center">
													{t('skillPlans.requiredLevel')}
												</TableHead>
												<TableHead className="text-center">
													{t('skillPlans.recommendedLevel')}
												</TableHead>
												{plan.canModify && (
													<TableHead className="w-[100px]">{t('skillPlans.actions')}</TableHead>
												)}
											</TableRow>
										</TableHeader>
										<TableBody>
											{skills.map((skill) => (
												<TableRow key={skill.skillId}>
													<TableCell className="font-medium">
														{skill.skillName ||
															t('skillPlans.unknownSkillIdValue1', { value1: skill.skillId })}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{skill.skillGroup || t('skillPlans.unknownGroup')}
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
																{t('skillPlans.remove')}
															</Button>
														</TableCell>
													)}
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<div className="text-center py-8 text-muted-foreground">
										<p>{t('skillPlans.noSkillsHaveBeenAddedToThisPlanYet')}</p>
										{plan.canModify && (
											<Button className="mt-4" asChild>
												<Link to={`/skill-plans/${id}/edit`}>
													<Plus className="h-4 w-4" />
													{t('skillPlans.addFirstSkill')}
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
