/**
 * Data enrichment functions for character skills and skill queue
 * Resolves skill type IDs to human-readable names using ESI Type Resolver
 */

import { getStub } from '@repo/do-utils'

import type { CharacterSkills, CharacterSkillQueue, EsiTypeResolver } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

/**
 * Enriched skill entry with resolved name
 */
export interface ProcessedSkill {
	skillId: string
	skillName?: string
	activeLevel: number
	trainedLevel: number
	skillpointsInSkill: number
}

/**
 * Enriched skill queue entry with resolved name
 */
export interface ProcessedSkillQueueEntry {
	skillId: string
	skillName?: string
	finishedLevel: number
	queuePosition: number
	startDate?: string
	finishDate?: string
}

/**
 * Combined processed skills data
 */
export interface ProcessedSkillsData {
	totalSp: number
	unallocatedSp?: number
	skillCount: number
	skills: ProcessedSkill[]
	skillQueue: ProcessedSkillQueueEntry[]
	processedAt: string
}

/**
 * Enrich character skills by resolving skill IDs to names
 *
 * @param env - Worker environment with ESI_TYPE_RESOLVER binding
 * @param skills - Character skills from ESI
 * @param skillQueue - Character skill queue from ESI
 * @param characterId - Character ID (for logging)
 * @returns Enriched skills data with resolved names
 */
export async function enrichSkills(
	env: { ESI_TYPE_RESOLVER: DurableObjectNamespace },
	skills: CharacterSkills,
	skillQueue: CharacterSkillQueue[],
	characterId: string,
): Promise<ProcessedSkillsData> {
	// Collect all skill IDs that need resolution
	const skillIds = new Set<string>()
	for (const skill of skills.skills) {
		skillIds.add(skill.skill_id)
	}
	for (const entry of skillQueue) {
		skillIds.add(entry.skill_id)
	}

	const idsArray = [...skillIds]

	// Batch resolve all skill IDs at once
	const nameMap: Record<string, string> = {}
	if (idsArray.length > 0) {
		try {
			const resolver = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
			const resolved = await resolver.resolveIds(idsArray)
			Object.assign(nameMap, resolved)
		} catch (error) {
			logger.error('[enrichSkills] Failed to resolve skill IDs:', {
				error: error instanceof Error ? error.message : String(error),
				idCount: idsArray.length,
			})
		}
	}

	// Build enriched skills sorted by name
	const processedSkills: ProcessedSkill[] = skills.skills
		.map((skill) => ({
			skillId: skill.skill_id,
			skillName: nameMap[skill.skill_id],
			activeLevel: skill.active_skill_level,
			trainedLevel: skill.trained_skill_level,
			skillpointsInSkill: skill.skillpoints_in_skill,
		}))
		.sort((a, b) => (a.skillName ?? '').localeCompare(b.skillName ?? ''))

	// Build enriched queue sorted by position
	const processedQueue: ProcessedSkillQueueEntry[] = skillQueue
		.map((entry) => ({
			skillId: entry.skill_id,
			skillName: nameMap[entry.skill_id],
			finishedLevel: entry.finished_level,
			queuePosition: entry.queue_position,
			startDate: entry.start_date,
			finishDate: entry.finish_date,
		}))
		.sort((a, b) => a.queuePosition - b.queuePosition)

	return {
		totalSp: skills.total_sp,
		unallocatedSp: skills.unallocated_sp,
		skillCount: skills.skills.length,
		skills: processedSkills,
		skillQueue: processedQueue,
		processedAt: new Date().toISOString(),
	}
}
