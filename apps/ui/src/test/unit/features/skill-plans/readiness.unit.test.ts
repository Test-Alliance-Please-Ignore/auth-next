import { describe, expect, it } from 'vitest'

import {
	calculateCharacterProgress,
	deriveReadinessStatus,
} from '@/features/skill-plans/utils/readiness'

describe('skill plan readiness calculator', () => {
	it('marks plan as completed when recommended levels are met', () => {
		const progress = calculateCharacterProgress({
			planId: 'plan-1',
			planName: 'Starter',
			characterId: '1001',
			characterName: 'Pilot One',
			planSkills: [
				{
					skillId: '1',
					skillName: 'Skill A',
					skillGroup: 'Core',
					requiredLevel: 3,
					recommendedLevel: 4,
					addedAt: '2025-01-01T00:00:00Z',
				},
			],
			characterSkillLevels: { '1': 4 },
		})

		expect(progress.percentageRequired).toBe(100)
		expect(progress.percentageRecommended).toBe(100)
		expect(progress.completedRequired).toBe(1)
		expect(progress.completedRecommended).toBe(1)
		expect(progress.skills[0]?.meetsRequired).toBe(true)
		expect(progress.skills[0]?.meetsRecommended).toBe(true)
	})

	it('returns partial progress when only some required skills are met', () => {
		const progress = calculateCharacterProgress({
			planId: 'plan-1',
			planName: 'Starter',
			characterId: '1001',
			characterName: 'Pilot One',
			planSkills: [
				{
					skillId: '1',
					skillName: 'Skill A',
					skillGroup: 'Core',
					requiredLevel: 3,
					recommendedLevel: 4,
					addedAt: '2025-01-01T00:00:00Z',
				},
				{
					skillId: '2',
					skillName: 'Skill B',
					skillGroup: 'Core',
					requiredLevel: 3,
					recommendedLevel: 4,
					addedAt: '2025-01-01T00:00:00Z',
				},
			],
			characterSkillLevels: { '1': 4, '2': 2 },
		})

		expect(progress.percentageRequired).toBe(50)
		expect(progress.percentageRecommended).toBe(50)
		expect(progress.completedRequired).toBe(1)
		expect(progress.completedRecommended).toBe(1)
		expect(progress.skills[1]?.meetsRequired).toBe(false)
	})

	it('returns missing progress when none of the required skills are met', () => {
		const progress = calculateCharacterProgress({
			planId: 'plan-1',
			planName: 'Starter',
			characterId: '1001',
			characterName: 'Pilot One',
			planSkills: [
				{
					skillId: '1',
					skillName: 'Skill A',
					skillGroup: 'Core',
					requiredLevel: 3,
					recommendedLevel: 4,
					addedAt: '2025-01-01T00:00:00Z',
				},
			],
			characterSkillLevels: { '1': 0 },
		})

		expect(progress.percentageRequired).toBe(0)
		expect(progress.percentageRecommended).toBe(0)
		expect(progress.completedRequired).toBe(0)
		expect(progress.completedRecommended).toBe(0)
		expect(progress.skills[0]?.meetsRequired).toBe(false)
		expect(progress.skills[0]?.meetsRecommended).toBe(false)
	})

	it('treats missing character skill entries as level 0', () => {
		const progress = calculateCharacterProgress({
			planId: 'plan-1',
			planName: 'Starter',
			characterId: '1001',
			characterName: 'Pilot One',
			planSkills: [
				{
					skillId: '999',
					skillName: 'Missing Skill',
					skillGroup: 'Core',
					requiredLevel: 1,
					recommendedLevel: 2,
					addedAt: '2025-01-01T00:00:00Z',
				},
			],
			characterSkillLevels: {},
		})

		expect(progress.skills[0]?.currentLevel).toBe(0)
		expect(progress.percentageRequired).toBe(0)
		expect(progress.percentageRecommended).toBe(0)
	})

	it('rounds percentages to two decimal places', () => {
		const progress = calculateCharacterProgress({
			planId: 'plan-1',
			planName: 'Starter',
			characterId: '1001',
			characterName: 'Pilot One',
			planSkills: [
				{
					skillId: '1',
					skillName: 'Skill A',
					skillGroup: 'Core',
					requiredLevel: 1,
					recommendedLevel: 1,
					addedAt: '2025-01-01T00:00:00Z',
				},
				{
					skillId: '2',
					skillName: 'Skill B',
					skillGroup: 'Core',
					requiredLevel: 1,
					recommendedLevel: 1,
					addedAt: '2025-01-01T00:00:00Z',
				},
				{
					skillId: '3',
					skillName: 'Skill C',
					skillGroup: 'Core',
					requiredLevel: 1,
					recommendedLevel: 1,
					addedAt: '2025-01-01T00:00:00Z',
				},
			],
			characterSkillLevels: { '1': 1 },
		})

		expect(progress.percentageRequired).toBe(33.33)
		expect(progress.percentageRecommended).toBe(33.33)
	})
})

describe('deriveReadinessStatus', () => {
	it('returns no_skills for plans without skills', () => {
		expect(
			deriveReadinessStatus({
				percentageRequired: 0,
				percentageRecommended: 0,
				totalSkills: 0,
			})
		).toBe('no_skills')
	})

	it('returns completed when recommended progress is 100%', () => {
		expect(
			deriveReadinessStatus({
				percentageRequired: 100,
				percentageRecommended: 100,
				totalSkills: 3,
			})
		).toBe('completed')
	})

	it('returns meets_requirements when required is 100% but recommended is below 100%', () => {
		expect(
			deriveReadinessStatus({
				percentageRequired: 100,
				percentageRecommended: 67,
				totalSkills: 3,
			})
		).toBe('meets_requirements')
	})

	it('returns incomplete when required progress is below 100%', () => {
		expect(
			deriveReadinessStatus({
				percentageRequired: 67,
				percentageRecommended: 34,
				totalSkills: 3,
			})
		).toBe('incomplete')
	})
})
