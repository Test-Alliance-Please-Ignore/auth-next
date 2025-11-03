/**
 * @fileoverview React hook for fetching and caching skill metadata
 *
 * This hook provides efficient batch lookup of skill metadata with
 * automatic caching and deduplication via React Query.
 */

import { useQuery } from '@tanstack/react-query'

import { api } from '../lib/api'

import type {
	CharacterSkill,
	EnhancedCharacterSkill,
	normalizeSkillId,
	SkillMetadata,
} from '@repo/eve-types'

/**
 * Categorized skills response from API
 */
interface CategorizedSkillsResponse {
	categoryId: string
	categoryName: string
	groups?: Array<{
		groupId: string
		groupName: string
		skills?: Array<{
			id: number | string
			name: string
			description?: string
			rank: number
		}>
	}>
}

/**
 * Fetch and cache skill metadata for a batch of skill IDs
 *
 * @param skillIds - Array of skill IDs to fetch metadata for
 * @returns Query result with skill metadata map
 *
 * @example
 * ```tsx
 * const skillIds = [3436, 3426, 3416]
 * const { data: skillMap } = useSkillMetadata(skillIds)
 *
 * const skillName = skillMap?.get(3436)?.name // "Shield Management"
 * ```
 */
export function useSkillMetadata(skillIds: (number | string)[]) {
	// Normalize and sort IDs for consistent cache key
	const normalizedIds = skillIds.map((id) => String(id))
	const sortedIds = [...normalizedIds].sort((a, b) => Number(a) - Number(b))
	const idsString = sortedIds.join(',')

	return useQuery({
		queryKey: ['skill-metadata', idsString],
		queryFn: async () => {
			if (skillIds.length === 0) {
				return new Map<number | string, SkillMetadata>()
			}

			// Call the API with comma-separated IDs
			const response = await api.getSkillMetadata(idsString)

			// Convert categorized response to a flat Map for easy lookup
			const skillMap = new Map<number | string, SkillMetadata>()

			if (Array.isArray(response)) {
				for (const category of response) {
					for (const group of category.groups || []) {
						for (const skill of group.skills || []) {
							// Store both string and number versions of the ID
							const metadata: SkillMetadata = {
								id: skill.id,
								name: skill.name,
								description: skill.description,
								rank: skill.rank,
								groupName: group.groupName,
								categoryName: category.categoryName,
							}

							// Store with both string and number keys for flexibility
							skillMap.set(Number(skill.id), metadata)
							skillMap.set(String(skill.id), metadata)
						}
					}
				}
			}

			return skillMap
		},
		enabled: skillIds.length > 0,
		staleTime: 1000 * 60 * 60, // 1 hour - skills rarely change
		gcTime: 1000 * 60 * 60 * 2, // 2 hours cache time
		retry: 1,
	})
}

/**
 * Enhanced version that enriches character skills with metadata
 *
 * @param characterSkills - Array of character skills from ESI
 * @returns Query result with enhanced skills including names and groups
 *
 * @example
 * ```tsx
 * const { data: enhancedSkills } = useEnhancedCharacterSkills(characterSkills)
 *
 * enhancedSkills?.forEach(skill => {
 *   console.log(`${skill.skillName} ${skill.trained_skill_level}`)
 * })
 * ```
 */
export function useEnhancedCharacterSkills(characterSkills?: CharacterSkill[]) {
	const skillIds = characterSkills?.map((s) => s.skill_id) || []
	const { data: skillMap, ...queryResult } = useSkillMetadata(skillIds)

	const enhancedSkills = characterSkills?.map((skill) => {
		const metadata = skillMap?.get(skill.skill_id)
		return {
			...skill,
			skillName: metadata?.name || `Unknown Skill #${skill.skill_id}`,
			skillGroup: metadata?.groupName || 'Unknown',
			skillCategory: metadata?.categoryName || 'Unknown',
			rank: metadata?.rank || 1,
			description: metadata?.description,
		} as EnhancedCharacterSkill
	})

	return {
		...queryResult,
		data: enhancedSkills,
	}
}

/**
 * Hook to fetch metadata for a single skill
 *
 * @param skillId - Single skill ID to fetch
 * @returns Query result with skill metadata
 *
 * @example
 * ```tsx
 * const { data: skill } = useSingleSkillMetadata(3436)
 * console.log(skill?.name) // "Shield Management"
 * ```
 */
export function useSingleSkillMetadata(skillId?: number | string) {
	const { data: skillMap, ...queryResult } = useSkillMetadata(skillId ? [skillId] : [])

	return {
		...queryResult,
		data: skillId ? skillMap?.get(skillId) : undefined,
	}
}

/**
 * Helper to get skill name from metadata map
 * Returns fallback if not found
 */
export function getSkillName(
	skillMap: Map<number | string, SkillMetadata> | undefined,
	skillId: number | string,
	fallback = `Unknown Skill #${skillId}`
): string {
	return skillMap?.get(skillId)?.name || fallback
}

/**
 * Helper to get skill with group formatted
 * Returns "Skill Name (Group)" format
 */
export function getSkillWithGroup(
	skillMap: Map<number | string, SkillMetadata> | undefined,
	skillId: number | string
): string {
	const metadata = skillMap?.get(skillId)
	if (!metadata) return `Unknown Skill #${skillId}`

	return metadata.groupName ? `${metadata.name} (${metadata.groupName})` : metadata.name
}
