import { useQuery } from '@tanstack/react-query'
import { GraduationCap } from 'lucide-react'
import { useState } from 'react'

import { api } from '../lib/api'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface Skill {
	active_skill_level: number
	skill_id: number
	skillpoints_in_skill: number
	trained_skill_level: number
}

interface CharacterSkillsProps {
	skills: {
		skills: Skill[]
		total_sp: number
		unallocated_sp?: number
	}
	characterId: string
	showProgress?: boolean
}

interface SkillMetadata {
	id: number
	name: string
	description: string
	rank: number
	primaryAttribute: string | null
	secondaryAttribute: string | null
}

interface SkillCategory {
	categoryId: number
	categoryName: string
	groups: Array<{
		groupId: number
		groupName: string
		skills: SkillMetadata[]
	}>
}

// Skill points required per level
const SKILL_POINTS_PER_LEVEL = [0, 250, 1414, 8000, 45255, 256000]

function calculateSkillProgress(skill: Skill, skillRank: number = 1): number {
	if (skill.trained_skill_level === 5) return 100

	const currentLevel = skill.trained_skill_level
	const nextLevel = currentLevel + 1

	const spForCurrentLevel = SKILL_POINTS_PER_LEVEL[currentLevel] * skillRank
	const spForNextLevel = SKILL_POINTS_PER_LEVEL[nextLevel] * skillRank
	const spNeeded = spForNextLevel - spForCurrentLevel
	const spProgress = skill.skillpoints_in_skill - spForCurrentLevel

	return Math.min(100, Math.max(0, (spProgress / spNeeded) * 100))
}

export function CharacterSkills({
	skills,
	showProgress = false,
}: CharacterSkillsProps) {
	const [expandedCategories, setExpandedCategories] = useState<string[]>([])

	// Fetch skill metadata from eve-static-data
	const { data: skillMetadata, isLoading: isLoadingMetadata } = useQuery({
		queryKey: ['skill-metadata', skills.skills.map((s) => s.skill_id)],
		queryFn: async () => {
			const skillIds = skills.skills.map((s) => s.skill_id).join(',')
			return api.getSkillMetadata(skillIds)
		},
		enabled: skills.skills.length > 0,
	})

	// Group skills by category
	type EnrichedSkill = SkillMetadata & {
		groupName: string
		characterSkill?: Skill
	}

	type CategorizedSkillGroup = SkillCategory & {
		totalSP: number
		trainedSkills: number
		totalSkills: number
		skills: EnrichedSkill[]
	}

	const categorizedSkills =
		skillMetadata?.reduce((acc, category) => {
			const categorySkills = category.groups
				.flatMap((group: { groupId: number; groupName: string; skills: SkillMetadata[] }) =>
					group.skills.map((skill: SkillMetadata) => ({
						...skill,
						groupName: group.groupName,
						characterSkill: skills.skills.find((s: Skill) => s.skill_id === skill.id),
					}))
				)
				.filter((skill: EnrichedSkill) => skill.characterSkill)

			if (categorySkills.length > 0) {
				acc.push({
					...category,
					totalSP: categorySkills.reduce(
						(sum: number, s: EnrichedSkill) => sum + (s.characterSkill?.skillpoints_in_skill || 0),
						0
					),
					trainedSkills: categorySkills.filter(
						(s: EnrichedSkill) => s.characterSkill && s.characterSkill.trained_skill_level > 0
					).length,
					totalSkills: categorySkills.length,
					skills: categorySkills,
				})
			}
			return acc
		}, [] as CategorizedSkillGroup[]) || []

	// Sort categories by total SP (highest first)
	categorizedSkills.sort((a: CategorizedSkillGroup, b: CategorizedSkillGroup) => b.totalSP - a.totalSP)

	const formatSP = (sp: number) => {
		if (sp >= 1000000) {
			return `${(sp / 1000000).toFixed(2)}M`
		} else if (sp >= 1000) {
			return `${(sp / 1000).toFixed(1)}K`
		}
		return sp.toString()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<GraduationCap className="h-5 w-5" />
						Skills
					</div>
					<div className="text-sm font-normal text-muted-foreground">
						Total SP: {formatSP(skills.total_sp)}
						{skills.unallocated_sp && skills.unallocated_sp > 0 && (
							<span className="ml-2">• Unallocated: {formatSP(skills.unallocated_sp)}</span>
						)}
					</div>
				</CardTitle>
			</CardHeader>
			<CardContent>
				{isLoadingMetadata ? (
					<div className="space-y-4">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
						))}
					</div>
				) : categorizedSkills.length === 0 ? (
					<p className="text-sm text-muted-foreground">No skills trained</p>
				) : (
					<Accordion
						type="multiple"
						value={expandedCategories}
						onValueChange={setExpandedCategories}
						className="space-y-2"
					>
						{categorizedSkills.map((category: CategorizedSkillGroup) => (
							<AccordionItem key={category.categoryId} value={`category-${category.categoryId}`}>
								<AccordionTrigger className="hover:no-underline">
									<div className="flex items-center justify-between w-full pr-2">
										<div className="flex items-center gap-2">
											<span className="font-medium">{category.categoryName}</span>
											<span className="text-xs text-muted-foreground">
												{category.trainedSkills}/{category.totalSkills} skills
											</span>
										</div>
										<span className="text-sm text-muted-foreground">
											{formatSP(category.totalSP)} SP
										</span>
									</div>
								</AccordionTrigger>
								<AccordionContent>
									<div className="space-y-3 pt-2">
										{category.skills
											.sort(
												(a: any, b: any) =>
													b.characterSkill.skillpoints_in_skill -
													a.characterSkill.skillpoints_in_skill
											)
											.map((skill: any) => {
												const progress = showProgress
													? calculateSkillProgress(skill.characterSkill, skill.rank)
													: 0

												return (
													<div key={skill.id} className="space-y-1">
														<div className="flex items-center justify-between">
															<div className="flex-1">
																<div className="flex items-center gap-2">
																	<span className="text-sm font-medium">{skill.name}</span>
																	<span className="text-xs text-muted-foreground">
																		Rank {skill.rank}
																	</span>
																</div>
																<p className="text-xs text-muted-foreground">
																	{skill.groupName} • Level{' '}
																	{skill.characterSkill.trained_skill_level}
																</p>
															</div>
															<div className="text-right">
																<p className="text-sm font-medium">
																	{formatSP(skill.characterSkill.skillpoints_in_skill)}
																</p>
																{skill.characterSkill.trained_skill_level < 5 && (
																	<p className="text-xs text-muted-foreground">
																		{Math.round(progress)}%
																	</p>
																)}
															</div>
														</div>
														{showProgress && skill.characterSkill.trained_skill_level < 5 && (
															<div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
																<div
																	className="h-full bg-blue-500 transition-all"
																	style={{ width: `${progress}%` }}
																/>
															</div>
														)}
													</div>
												)
											})}
									</div>
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				)}
			</CardContent>
		</Card>
	)
}
