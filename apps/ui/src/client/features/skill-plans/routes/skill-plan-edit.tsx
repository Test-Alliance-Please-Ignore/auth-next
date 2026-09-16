import { ArrowLeft, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { useAppTranslation } from '@/i18n'

import { EvemonXmlImporter } from '../../../components/evemon-xml-importer'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import { Select } from '../../../components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '../../../components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { SkillPlanForm } from '../components/skill-plan-form'
import { SkillSelector } from '../components/skill-selector'
import {
	useAddSkillToPlan,
	useBatchAddSkillsToPlan,
	usePlanSkills,
	useRemoveSkillFromPlan,
	useSkillPlan,
	useUpdateSkillLevels,
	useUpdateSkillPlan,
} from '../hooks'

import type { ParsedEvemonSkill } from '../../../lib/evemon-parser'
import type { AddSkillRequest, UpdateSkillPlanRequest } from '../types'

export default function SkillPlanEdit() {
	const { t } = useAppTranslation()

	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const [activeTab, setActiveTab] = useState('details')
	const [showImporter, setShowImporter] = useState(false)

	const { data: plan, isLoading: planLoading } = useSkillPlan(id!)
	const { data: skills, isLoading: skillsLoading, refetch: refetchSkills } = usePlanSkills(id!)
	const updatePlan = useUpdateSkillPlan()
	const addSkill = useAddSkillToPlan()
	const removeSkill = useRemoveSkillFromPlan()
	const updateSkillLevels = useUpdateSkillLevels()
	const batchAddSkills = useBatchAddSkillsToPlan()

	usePageTitle(
		plan ? t('skillPlans.editValue1', { value1: plan.name }) : t('skillPlans.editSkillPlan')
	)

	if (!id) {
		return <Navigate to="/skill-plans" replace />
	}

	if (planLoading || skillsLoading) {
		return <LoadingPage />
	}

	if (!plan) {
		return <Navigate to="/skill-plans" replace />
	}

	// Check if user can modify this plan
	if (!plan.canModify) {
		return <Navigate to={`/skill-plans/${id}`} replace />
	}

	const handleUpdatePlan = async (data: UpdateSkillPlanRequest) => {
		try {
			await updatePlan.mutateAsync({ planId: id, data })
			// Navigate back to detail view
			void navigate(`/skill-plans/${id}`)
		} catch (error) {
			console.error('Failed to update plan:', error)
		}
	}

	const handleAddSkill = async (skill: AddSkillRequest) => {
		try {
			await addSkill.mutateAsync({ planId: id, data: skill })
			// Refetch skills to update the list
			void refetchSkills()
		} catch (error) {
			console.error('Failed to add skill:', error)
		}
	}

	const handleRemoveSkill = async (skillId: string) => {
		if (confirm(t('skillPlans.areYouSureYouWantToRemoveThisSkillFrom'))) {
			try {
				await removeSkill.mutateAsync({ planId: id, skillId })
				// Refetch skills to update the list
				void refetchSkills()
			} catch (error) {
				console.error('Failed to remove skill:', error)
			}
		}
	}

	const handleUpdateSkillLevel = async (
		skillId: string,
		field: 'requiredLevel' | 'recommendedLevel',
		value: string
	) => {
		const level = parseInt(value)
		if (isNaN(level) || level < 1 || level > 5) return

		try {
			await updateSkillLevels.mutateAsync({
				planId: id,
				skillId,
				data: { [field]: level },
			})
			// Refetch skills to update the list
			void refetchSkills()
		} catch (error) {
			console.error('Failed to update skill level:', error)
		}
	}

	const handleImportEvemon = async (importedSkills: ParsedEvemonSkill[]) => {
		try {
			const result = await batchAddSkills.mutateAsync({
				planId: id,
				skills: importedSkills.map((skill) => ({
					skillId: skill.skillId,
					requiredLevel: skill.requiredLevel,
					recommendedLevel: skill.recommendedLevel,
				})),
			})

			// Hide importer and refetch skills
			setShowImporter(false)
			void refetchSkills()

			// Show success message (in a real app, use a toast)
			if (result.successful > 0) {
				alert(t('skillPlans.importedSkills', { count: result.successful }))
			}
			if (result.failed > 0) {
				console.warn(t('skillPlans.importFailures', { value1: result.failed }), result.errors)
			}
		} catch (error) {
			console.error('Failed to import skills:', error)
		}
	}

	const existingSkillIds = skills?.map((s) => s.skillId) || []

	return (
		<Container>
			<PageHeader
				title={t('skillPlans.editValue12', { value1: plan.name })}
				description={t('skillPlans.modifyPlanDetailsAndManageSkills')}
				action={
					<Button variant="ghost" size="sm" asChild>
						<Link to={`/skill-plans/${id}`}>
							<ArrowLeft className="h-4 w-4" />
							{t('skillPlans.backToPlan')}
						</Link>
					</Button>
				}
			/>

			<Section>
				{/* Tabs for different sections */}
				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList>
						<TabsTrigger value="details">{t('skillPlans.planDetails')}</TabsTrigger>
						<TabsTrigger value="skills">
							{t('skillPlans.manageSkills2')}
							{skills?.length || 0})
						</TabsTrigger>
					</TabsList>

					{/* Details Tab */}
					<TabsContent value="details" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>{t('skillPlans.editPlanDetails')}</CardTitle>
							</CardHeader>
							<CardContent>
								<SkillPlanForm
									initialData={plan}
									onSubmit={handleUpdatePlan}
									onCancel={() => navigate(`/skill-plans/${id}`)}
									isSubmitting={updatePlan.isPending}
									mode="edit"
								/>
							</CardContent>
						</Card>
					</TabsContent>

					{/* Skills Tab */}
					<TabsContent value="skills" className="space-y-4">
						{/* Add new skill */}
						{showImporter ? (
							<EvemonXmlImporter
								onImport={handleImportEvemon}
								onCancel={() => setShowImporter(false)}
								isLoading={batchAddSkills.isPending}
							/>
						) : (
							<Card>
								<CardHeader className="flex flex-row items-center justify-between">
									<CardTitle>{t('skillPlans.addSkillsToPlan')}</CardTitle>
									<Button
										variant="ghost"
										onClick={() => setShowImporter(true)}
										disabled={addSkill.isPending}
									>
										<Upload className="h-4 w-4" />
										{t('skillPlans.importFromEvemon')}
									</Button>
								</CardHeader>
								<CardContent>
									<SkillSelector
										existingSkillIds={existingSkillIds}
										onAddSkill={handleAddSkill}
										isSubmitting={addSkill.isPending}
									/>
								</CardContent>
							</Card>
						)}

						{/* Current skills */}
						<Card>
							<CardHeader>
								<CardTitle>{t('skillPlans.currentSkillsInPlan')}</CardTitle>
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
												<TableHead className="w-[100px]">{t('skillPlans.actions')}</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{skills.map((skill) => (
												<TableRow key={skill.skillId}>
													<TableCell className="font-medium">
														{skill.skillName || skill.skillId}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{skill.skillGroup || t('skillPlans.unknown')}
													</TableCell>
													<TableCell className="text-center">
														<Select
															value={String(skill.requiredLevel)}
															onValueChange={(value) =>
																handleUpdateSkillLevel(skill.skillId, 'requiredLevel', value)
															}
															options={[0, 1, 2, 3, 4, 5].map((level) => ({
																value: String(level),
																label: level === 0 ? t('skillPlans.optional') : String(level),
															}))}
															className="w-20 mx-auto"
															disabled={updateSkillLevels.isPending}
														/>
													</TableCell>
													<TableCell className="text-center">
														<Select
															value={String(skill.recommendedLevel)}
															onValueChange={(value) =>
																handleUpdateSkillLevel(skill.skillId, 'recommendedLevel', value)
															}
															options={[1, 2, 3, 4, 5]
																.filter((level) => level >= skill.requiredLevel)
																.map((level) => ({ value: String(level), label: String(level) }))}
															className="w-20 mx-auto"
															disabled={updateSkillLevels.isPending}
														/>
													</TableCell>
													<TableCell>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleRemoveSkill(skill.skillId)}
															disabled={removeSkill.isPending}
														>
															<Trash2 className="h-4 w-4 text-destructive" />
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								) : (
									<div className="text-center py-8 text-muted-foreground">
										<p>{t('skillPlans.noSkillsHaveBeenAddedToThisPlanYet')}</p>
										<p className="mt-2 text-sm">{t('skillPlans.useTheFormAboveToAddSkills')}</p>
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
