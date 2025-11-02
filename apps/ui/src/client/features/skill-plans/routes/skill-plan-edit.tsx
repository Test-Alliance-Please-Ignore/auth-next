import { useState, useEffect } from 'react'
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom'
import { ArrowLeft, Save, Trash2, Upload, Plus } from 'lucide-react'
import { usePageTitle } from '../../../hooks/usePageTitle'
import { useAuth } from '../../../hooks/useAuth'
import {
	useSkillPlan,
	usePlanSkills,
	useUpdateSkillPlan,
	useAddSkillToPlan,
	useRemoveSkillFromPlan,
	useUpdateSkillLevels,
	useBatchAddSkillsToPlan,
} from '../hooks'
import { SkillPlanForm } from '../components/skill-plan-form'
import { SkillSelector } from '../components/skill-selector'
import { EvemonXmlImporter } from '../../../components/evemon-xml-importer'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Container } from '../../../components/ui/container'
import { LoadingPage } from '../../../components/ui/loading'
import { PageHeader } from '../../../components/ui/page-header'
import { Section } from '../../../components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '../../../components/ui/table'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../../../components/ui/select'
import type { UpdateSkillPlanRequest, AddSkillRequest } from '../types'
import type { ParsedEvemonSkill } from '../../../lib/evemon-parser'

export default function SkillPlanEdit() {
	const { id } = useParams<{ id: string }>()
	const navigate = useNavigate()
	const { user } = useAuth()
	const [activeTab, setActiveTab] = useState('details')
	const [showImporter, setShowImporter] = useState(false)

	const { data: plan, isLoading: planLoading } = useSkillPlan(id!)
	const { data: skills, isLoading: skillsLoading, refetch: refetchSkills } = usePlanSkills(id!)
	const updatePlan = useUpdateSkillPlan()
	const addSkill = useAddSkillToPlan()
	const removeSkill = useRemoveSkillFromPlan()
	const updateSkillLevels = useUpdateSkillLevels()
	const batchAddSkills = useBatchAddSkillsToPlan()

	usePageTitle(plan ? `Edit ${plan.name}` : 'Edit Skill Plan')

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
			navigate(`/skill-plans/${id}`)
		} catch (error) {
			console.error('Failed to update plan:', error)
		}
	}

	const handleAddSkill = async (skill: AddSkillRequest) => {
		try {
			await addSkill.mutateAsync({ planId: id, data: skill })
			// Refetch skills to update the list
			refetchSkills()
		} catch (error) {
			console.error('Failed to add skill:', error)
		}
	}

	const handleRemoveSkill = async (skillId: string) => {
		if (confirm('Are you sure you want to remove this skill from the plan?')) {
			try {
				await removeSkill.mutateAsync({ planId: id, skillId })
				// Refetch skills to update the list
				refetchSkills()
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
			refetchSkills()
		} catch (error) {
			console.error('Failed to update skill level:', error)
		}
	}

	const handleImportEvemon = async (importedSkills: ParsedEvemonSkill[]) => {
		try {
			const result = await batchAddSkills.mutateAsync({
				planId: id,
				skills: importedSkills.map(skill => ({
					skillId: skill.skillId,
					requiredLevel: skill.requiredLevel,
					recommendedLevel: skill.recommendedLevel,
				}))
			})

			// Hide importer and refetch skills
			setShowImporter(false)
			refetchSkills()

			// Show success message (in a real app, use a toast)
			if (result.successful > 0) {
				alert(`Successfully imported ${result.successful} skill${result.successful !== 1 ? 's' : ''}`)
			}
			if (result.failed > 0) {
				console.warn(`Failed to import ${result.failed} skill${result.failed !== 1 ? 's' : ''}`, result.errors)
			}
		} catch (error) {
			console.error('Failed to import skills:', error)
		}
	}

	const existingSkillIds = skills?.map(s => s.skillId) || []

	return (
		<Container>
			<PageHeader
				title={`Edit: ${plan.name}`}
				description="Modify plan details and manage skills"
			/>

			<Section>
				{/* Navigation buttons */}
				<div className="flex justify-between items-center mb-6">
					<Button variant="outline" asChild>
						<Link to={`/skill-plans/${id}`}>
							<ArrowLeft className="h-4 w-4 mr-2" />
							Back to Plan
						</Link>
					</Button>
				</div>

				{/* Tabs for different sections */}
				<Tabs value={activeTab} onValueChange={setActiveTab}>
					<TabsList>
						<TabsTrigger value="details">Plan Details</TabsTrigger>
						<TabsTrigger value="skills">Manage Skills ({skills?.length || 0})</TabsTrigger>
					</TabsList>

					{/* Details Tab */}
					<TabsContent value="details" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Edit Plan Details</CardTitle>
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
									<CardTitle>Add Skills to Plan</CardTitle>
									<Button
										variant="outline"
										onClick={() => setShowImporter(true)}
										disabled={addSkill.isPending}
									>
										<Upload className="h-4 w-4 mr-2" />
										Import from EVEMon
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
								<CardTitle>Current Skills in Plan</CardTitle>
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
												<TableHead className="w-[100px]">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{skills.map((skill) => (
												<TableRow key={skill.skillId}>
													<TableCell className="font-medium">
														{skill.skillName || skill.skillId}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{skill.skillGroup || 'Unknown'}
													</TableCell>
													<TableCell className="text-center">
														<Select
															value={String(skill.requiredLevel)}
															onValueChange={(value) =>
																handleUpdateSkillLevel(skill.skillId, 'requiredLevel', value)
															}
															disabled={updateSkillLevels.isPending}
														>
															<SelectTrigger className="w-20 mx-auto">
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																{[1, 2, 3, 4, 5].map((level) => (
																	<SelectItem key={level} value={String(level)}>
																		{level}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</TableCell>
													<TableCell className="text-center">
														<Select
															value={String(skill.recommendedLevel)}
															onValueChange={(value) =>
																handleUpdateSkillLevel(skill.skillId, 'recommendedLevel', value)
															}
															disabled={updateSkillLevels.isPending}
														>
															<SelectTrigger className="w-20 mx-auto">
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																{[1, 2, 3, 4, 5].map((level) => (
																	<SelectItem
																		key={level}
																		value={String(level)}
																		disabled={level < skill.requiredLevel}
																	>
																		{level}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
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
										<p>No skills have been added to this plan yet.</p>
										<p className="mt-2 text-sm">Use the form above to add skills.</p>
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