/**
 * @fileoverview EVE Online Skill Type Definitions
 *
 * This module provides comprehensive type definitions for EVE Online skills,
 * including display formatting, queue entries, and metadata structures.
 */

import type { EveCharacterId, EveSkillId } from './index'

/**
 * Basic skill reference with minimal information
 */
export interface SkillReference {
	/** Unique skill identifier (always string) */
	skillId: EveSkillId
	/** Human-readable skill name */
	skillName: string
	/** Optional skill group (e.g., "Shields", "Navigation") */
	skillGroup?: string
	/** Optional skill category (e.g., "Spaceship Command") */
	skillCategory?: string
}

/**
 * Skill with level information for display
 */
export interface SkillWithLevel extends SkillReference {
	/** Current trained level (0-5) */
	currentLevel: number
	/** Required level for a plan or prerequisite */
	requiredLevel?: number
	/** Recommended level for optimal performance */
	recommendedLevel?: number
	/** Total skill points in this skill */
	skillPoints?: number
}

/**
 * Skill queue entry from ESI
 */
export interface SkillQueueEntry {
	/** Position in the skill queue (0-based) */
	queuePosition: number
	/** Skill identifier (from ESI, typically number) */
	skillId: number
	/** Level being trained to (1-5) */
	finishedLevel: number
	/** When training started (ISO string) */
	startDate?: string
	/** When training will complete (ISO string) */
	finishDate?: string
	/** Skill points at start of this level */
	levelStartSp?: number
	/** Skill points at end of this level */
	levelEndSp?: number
	/** Skill points when training started */
	trainingStartSp?: number
}

/**
 * Enhanced skill queue entry with resolved metadata
 */
export interface EnhancedSkillQueueEntry extends SkillQueueEntry {
	/** Resolved skill name */
	skillName: string
	/** Resolved skill group */
	skillGroup?: string
	/** Calculated progress percentage (0-100) */
	progressPercent?: number
	/** Time remaining in milliseconds */
	timeRemaining?: number
	/** Whether this skill is currently training */
	isTraining: boolean
}

/**
 * Character's trained skill from ESI
 */
export interface CharacterSkill {
	/** Skill identifier (from ESI, typically number) */
	skill_id: number | string
	/** Currently active skill level (0-5) */
	active_skill_level: number
	/** Trained skill level (may differ from active during training) */
	trained_skill_level: number
	/** Total skill points in this skill */
	skillpoints_in_skill: number
}

/**
 * Enhanced character skill with metadata
 */
export interface EnhancedCharacterSkill extends CharacterSkill {
	/** Resolved skill name */
	skillName: string
	/** Resolved skill group */
	skillGroup: string
	/** Resolved skill category */
	skillCategory: string
	/** Skill rank/difficulty multiplier */
	rank: number
	/** Skill description */
	description?: string
}

/**
 * Skill metadata from Skills Durable Object
 */
export interface SkillMetadata {
	/** Skill identifier (always string in our system) */
	id: string | number
	/** Human-readable skill name */
	name: string
	/** Skill description */
	description?: string
	/** Training time multiplier */
	rank: number
	/** Primary attribute */
	primaryAttribute?: string
	/** Secondary attribute */
	secondaryAttribute?: string
	/** Group this skill belongs to */
	groupName?: string
	/** Category this skill belongs to */
	categoryName?: string
}

/**
 * Skill plan entry
 */
export interface SkillPlanEntry {
	/** Skill identifier */
	skillId: EveSkillId
	/** Human-readable skill name */
	skillName: string
	/** Skill group */
	skillGroup?: string
	/** Minimum required level */
	requiredLevel: number
	/** Recommended level for optimal performance */
	recommendedLevel: number
	/** Display order in the plan */
	displayOrder?: number
	/** Optional notes about this skill */
	notes?: string
}

/**
 * Character's progress on a skill plan
 */
export interface SkillPlanProgress {
	/** Character being checked */
	characterId: EveCharacterId
	/** Character name */
	characterName: string
	/** Plan being checked against */
	planId: string
	/** Plan name */
	planName: string
	/** Total skills in plan */
	totalSkills: number
	/** Skills meeting minimum requirements */
	completedRequired: number
	/** Skills meeting recommended levels */
	completedRecommended: number
	/** Percentage of required skills met (0-100) */
	percentageRequired: number
	/** Percentage of recommended skills met (0-100) */
	percentageRecommended: number
	/** Individual skill progress */
	skills: SkillProgressEntry[]
}

/**
 * Individual skill progress in a plan
 */
export interface SkillProgressEntry {
	/** Skill identifier */
	skillId: EveSkillId
	/** Skill name */
	skillName: string
	/** Current trained level */
	currentLevel: number
	/** Required level in plan */
	requiredLevel: number
	/** Recommended level in plan */
	recommendedLevel: number
	/** Whether minimum requirement is met */
	meetsRequired: boolean
	/** Whether recommended level is met */
	meetsRecommended: boolean
	/** Skill points needed to reach required level */
	spToRequired?: number
	/** Skill points needed to reach recommended level */
	spToRecommended?: number
	/** Estimated training time to required (milliseconds) */
	timeToRequired?: number
	/** Estimated training time to recommended (milliseconds) */
	timeToRecommended?: number
}

/**
 * Categorized skill structure for UI display
 */
export interface CategorizedSkills {
	/** Category name (e.g., "Spaceship Command") */
	categoryName: string
	/** Category ID */
	categoryId?: string
	/** Total skill points in this category */
	totalSkillPoints?: number
	/** Groups within this category */
	groups: SkillGroupDisplay[]
}

/**
 * Skill group for UI display
 */
export interface SkillGroupDisplay {
	/** Group name (e.g., "Shields") */
	groupName: string
	/** Group ID */
	groupId?: string
	/** Total skill points in this group */
	totalSkillPoints?: number
	/** Skills in this group */
	skills: SkillDisplay[]
}

/**
 * Skill for UI display with all formatting info
 */
export interface SkillDisplay {
	/** Skill identifier */
	id: string | number
	/** Skill name */
	name: string
	/** Current level (0-5) */
	level: number
	/** Skill points */
	skillPoints: number
	/** Training rank/difficulty */
	rank: number
	/** Whether skill is currently training */
	isTraining?: boolean
	/** Progress if training (0-100) */
	trainingProgress?: number
	/** Formatted display string */
	displayString?: string
}

/**
 * Skill display format options
 */
export interface SkillFormatOptions {
	/** Include skill level */
	includeLevel?: boolean
	/** Use Roman numerals for level */
	useRomanNumerals?: boolean
	/** Include skill group */
	includeGroup?: boolean
	/** Include skill points */
	includeSkillPoints?: boolean
	/** Include training indicator */
	includeTrainingStatus?: boolean
	/** Format for skill points (compact, full, scientific) */
	skillPointFormat?: 'compact' | 'full' | 'scientific'
}

/**
 * Roman numeral levels for skills
 */
export const SKILL_LEVELS_ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'] as const

/**
 * Skill level names
 */
export const SKILL_LEVEL_NAMES = [
	'Untrained',
	'Level I',
	'Level II',
	'Level III',
	'Level IV',
	'Level V'
] as const

/**
 * Helper type for skill level (0-5)
 */
export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5

/**
 * Helper type for Roman numeral skill level
 */
export type RomanSkillLevel = typeof SKILL_LEVELS_ROMAN[number]

/**
 * Convert numeric level to Roman numeral
 */
export function toRomanLevel(level: number): string {
	if (level < 0 || level > 5) return String(level)
	return SKILL_LEVELS_ROMAN[level]
}

/**
 * Format skill name with level
 * @example formatSkillWithLevel("Shield Management", 4) => "Shield Management IV"
 */
export function formatSkillWithLevel(
	skillName: string,
	level: number,
	useRoman = true
): string {
	if (level === 0) return `${skillName} (Untrained)`
	const levelStr = useRoman ? toRomanLevel(level) : String(level)
	return `${skillName} ${levelStr}`
}

/**
 * Format skill name with group
 * @example formatSkillWithGroup("Shield Management", "Shields") => "Shield Management (Shields)"
 */
export function formatSkillWithGroup(skillName: string, groupName?: string): string {
	return groupName ? `${skillName} (${groupName})` : skillName
}

/**
 * Format skill points for display
 * @example formatSkillPoints(1234567) => "1.23M SP"
 */
export function formatSkillPoints(sp: number, format: 'compact' | 'full' = 'compact'): string {
	if (format === 'compact') {
		if (sp >= 1_000_000) {
			return `${(sp / 1_000_000).toFixed(2)}M SP`
		} else if (sp >= 1_000) {
			return `${(sp / 1_000).toFixed(0)}K SP`
		}
		return `${sp} SP`
	}
	// Full format with commas
	return `${sp.toLocaleString()} SP`
}

/**
 * Calculate training time in milliseconds
 */
export function calculateTrainingTime(
	startSp: number,
	endSp: number,
	spPerHour: number
): number {
	if (spPerHour <= 0) return 0
	const spNeeded = endSp - startSp
	return (spNeeded / spPerHour) * 60 * 60 * 1000 // Convert hours to milliseconds
}

/**
 * Format training time for display
 * @example formatTrainingTime(7200000) => "2 hours"
 */
export function formatTrainingTime(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)

	if (days > 0) {
		const remainingHours = hours % 24
		return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days} days`
	}
	if (hours > 0) {
		const remainingMinutes = minutes % 60
		return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours} hours`
	}
	if (minutes > 0) {
		return `${minutes} minutes`
	}
	return `${seconds} seconds`
}

/**
 * Get skill training status indicator
 */
export function getSkillStatusIcon(
	currentLevel: number,
	requiredLevel: number,
	isTraining = false
): '✅' | '🔄' | '⏸️' | '❌' {
	if (currentLevel >= requiredLevel) return '✅'
	if (isTraining) return '🔄'
	if (currentLevel > 0) return '⏸️'
	return '❌'
}

/**
 * Type guard to check if a skill ID is valid
 */
export function isValidSkillId(id: unknown): id is string | number {
	return typeof id === 'string' || typeof id === 'number'
}

/**
 * Normalize skill ID to string
 */
export function normalizeSkillId(id: string | number): string {
	return String(id)
}