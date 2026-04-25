import type { CharacterProgress, SkillPlanSkill } from '../types'

export interface CharacterSkillLevels {
	characterId: string
	characterName: string
	levels: Record<string, number>
}

export type ReadinessStatus = 'completed' | 'meets_requirements' | 'incomplete' | 'no_skills'
export interface CharacterReadinessSummary {
	completed: number
	meetsRequirements: number
	incomplete: number
	total: number
}

interface CalculateCharacterProgressInput {
	planId: string
	planName: string
	characterId: string
	characterName: string
	planSkills: SkillPlanSkill[]
	characterSkillLevels: Record<string, number>
}

function roundToTwo(value: number): number {
	return Math.round(value * 100) / 100
}

export function deriveReadinessStatus(readiness: {
	percentageRequired: number
	percentageRecommended: number
	totalSkills: number
}): ReadinessStatus {
	if (readiness.totalSkills === 0) {
		return 'no_skills'
	}

	if (readiness.percentageRecommended >= 100) {
		return 'completed'
	}

	if (readiness.percentageRequired >= 100) {
		return 'meets_requirements'
	}

	return 'incomplete'
}

export function summarizeReadinessStatuses(
	statuses: ReadinessStatus[]
): CharacterReadinessSummary {
	let completed = 0
	let meetsRequirements = 0
	let incomplete = 0
	let total = 0

	for (const status of statuses) {
		if (status === 'completed') {
			completed += 1
			total += 1
			continue
		}
		if (status === 'meets_requirements') {
			meetsRequirements += 1
			total += 1
			continue
		}
		if (status === 'incomplete') {
			incomplete += 1
			total += 1
		}
	}

	return {
		completed,
		meetsRequirements,
		incomplete,
		total,
	}
}

export function calculateCharacterProgress({
	planId,
	planName,
	characterId,
	characterName,
	planSkills,
	characterSkillLevels,
}: CalculateCharacterProgressInput): CharacterProgress {
	const skills = planSkills.map((planSkill) => {
		const currentLevel = characterSkillLevels[String(planSkill.skillId)] ?? 0
		const meetsRequired = currentLevel >= planSkill.requiredLevel
		const meetsRecommended = currentLevel >= planSkill.recommendedLevel

		return {
			skillId: String(planSkill.skillId),
			skillName: planSkill.skillName,
			requiredLevel: planSkill.requiredLevel,
			recommendedLevel: planSkill.recommendedLevel,
			currentLevel,
			meetsRequired,
			meetsRecommended,
		}
	})

	const totalSkills = skills.length
	const completedRequired = skills.filter(
		(skill) => skill.meetsRequired || skill.meetsRecommended
	).length
	const completedRecommended = skills.filter((skill) => skill.meetsRecommended).length

	const percentageRequired = totalSkills > 0 ? (completedRequired / totalSkills) * 100 : 0
	const percentageRecommended =
		totalSkills > 0 ? (completedRecommended / totalSkills) * 100 : 0

	return {
		characterId,
		characterName,
		planId,
		planName,
		totalSkills,
		completedRequired,
		completedRecommended,
		percentageRequired: roundToTwo(percentageRequired),
		percentageRecommended: roundToTwo(percentageRecommended),
		skills,
	}
}
