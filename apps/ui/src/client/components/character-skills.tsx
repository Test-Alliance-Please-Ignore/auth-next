import { GraduationCap } from 'lucide-react'
import { useState } from 'react'
import { formatSkillWithLevel, formatSkillPoints, toRomanLevel } from '@repo/eve-types'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface Skill {
	activeSkillLevel: number
	skillId: number
	skillpointsInSkill: number
	trainedSkillLevel: number
	// Enriched fields from backend
	skillName?: string
	skillGroup?: string
	skillCategory?: string
	rank?: number
	description?: string
}

interface CharacterSkillsProps {
	skills: {
		skills: Skill[]
		totalSp: number
		unallocatedSp?: number
	}
	characterId: string
	showProgress?: boolean
}

// Skill points required per level
const SKILL_POINTS_PER_LEVEL = [0, 250, 1414, 8000, 45255, 256000]

function calculateSkillProgress(skill: Skill, skillRank: number = 1): number {
	if (skill.trainedSkillLevel === 5) return 100

	const currentLevel = skill.trainedSkillLevel
	const nextLevel = currentLevel + 1

	const spForCurrentLevel = SKILL_POINTS_PER_LEVEL[currentLevel] * skillRank
	const spForNextLevel = SKILL_POINTS_PER_LEVEL[nextLevel] * skillRank
	const spNeeded = spForNextLevel - spForCurrentLevel
	const spProgress = skill.skillpointsInSkill - spForCurrentLevel

	return Math.min(100, Math.max(0, (spProgress / spNeeded) * 100))
}

export function CharacterSkills({ skills, showProgress = false }: CharacterSkillsProps) {
	const [expandedCategories, setExpandedCategories] = useState<string[]>([])

	// Skills now come enriched from the backend, no need for separate metadata fetch

	// Group skills by category
	type CategorizedSkillGroup = {
		categoryName: string
		totalSP: number
		trainedSkills: number
		totalSkills: number
		skills: Skill[]
	}

	const categorizedSkills = skills.skills.reduce((acc: CategorizedSkillGroup[], skill) => {
		const categoryName = skill.skillCategory || 'Uncategorized'

		// Find or create category
		let category = acc.find(c => c.categoryName === categoryName)
		if (!category) {
			category = {
				categoryName,
				totalSP: 0,
				trainedSkills: 0,
				totalSkills: 0,
				skills: []
			}
			acc.push(category)
		}

		// Add skill to category
		category.skills.push(skill)
		category.totalSP += skill.skillpointsInSkill
		category.totalSkills++
		if (skill.trainedSkillLevel > 0) {
			category.trainedSkills++
		}

		return acc
	}, [])

	// Sort categories by total SP (highest first)
	categorizedSkills.sort(
		(a: CategorizedSkillGroup, b: CategorizedSkillGroup) => b.totalSP - a.totalSP
	)


	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<GraduationCap className="h-5 w-5" />
						Skills
					</div>
					<div className="text-sm font-normal text-muted-foreground">
						Total SP: {formatSkillPoints(skills.totalSp)}
						{skills.unallocatedSp && skills.unallocatedSp > 0 && (
							<span className="ml-2">• Unallocated: {formatSkillPoints(skills.unallocatedSp)}</span>
						)}
					</div>
				</CardTitle>
			</CardHeader>
			<CardContent>
				{categorizedSkills.length === 0 ? (
					<p className="text-sm text-muted-foreground">No skills trained</p>
				) : (
					<Accordion
						type="multiple"
						value={expandedCategories}
						onValueChange={setExpandedCategories}
						className="space-y-2"
					>
						{categorizedSkills.map((category: CategorizedSkillGroup) => (
							<AccordionItem key={category.categoryName} value={`category-${category.categoryName}`}>
								<AccordionTrigger className="hover:no-underline">
									<div className="flex items-center justify-between w-full pr-2">
										<div className="flex items-center gap-2">
											<span className="font-medium">{category.categoryName}</span>
											<span className="text-xs text-muted-foreground">
												{category.trainedSkills}/{category.totalSkills} skills
											</span>
										</div>
										<span className="text-sm text-muted-foreground">
											{formatSkillPoints(category.totalSP)} SP
										</span>
									</div>
								</AccordionTrigger>
								<AccordionContent>
									<div className="space-y-3 pt-2">
										{category.skills
											.sort((a: Skill, b: Skill) => b.skillpointsInSkill - a.skillpointsInSkill)
											.map((skill: Skill) => {
												const progress = showProgress
													? calculateSkillProgress(skill, skill.rank || 1)
													: 0

												return (
													<div key={skill.skillId} className="space-y-1">
														<div className="flex items-center justify-between">
															<div className="flex-1">
																<div className="flex items-center gap-2">
																	<span className="text-sm font-medium">
																		{formatSkillWithLevel(
																			skill.skillName || `Unknown Skill (${skill.skillId})`,
																			skill.trainedSkillLevel
																		)}
																	</span>
																	{skill.rank && (
																		<span className="text-xs text-muted-foreground">
																			Rank {skill.rank}
																		</span>
																	)}
																</div>
																{skill.skillGroup && (
																	<p className="text-xs text-muted-foreground">
																		{skill.skillGroup}
																	</p>
																)}
															</div>
															<div className="text-right">
																<p className="text-sm font-medium">
																	{formatSkillPoints(skill.skillpointsInSkill)}
																</p>
																{skill.trainedSkillLevel < 5 && (
																	<p className="text-xs text-muted-foreground">
																		{Math.round(progress)}% to Level {toRomanLevel(skill.trainedSkillLevel + 1)}
																	</p>
																)}
															</div>
														</div>
														{showProgress && skill.trainedSkillLevel < 5 && (
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
