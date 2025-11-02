/**
 * EVEMon XML skill plan parser
 * Parses EVEMon XML format and consolidates entries by skill
 */

export interface ParsedEvemonSkill {
	skillId: number
	skillName: string
	requiredLevel: number
	recommendedLevel: number
	priority: number
}

export interface ParseResult {
	success: boolean
	skills?: ParsedEvemonSkill[]
	error?: string
}

/**
 * Parse EVEMon XML skill plan
 * Priority 1-9: Contributes to both required and recommended levels (max level used for both)
 * Priority 10: Contributes only to recommended level (required level = 0)
 * When a skill has mixed priorities, required = max from priorities 1-9, recommended = max from all priorities
 */
export function parseEvemonXml(xmlContent: string): ParseResult {
	try {
		const parser = new DOMParser()
		const doc = parser.parseFromString(xmlContent, 'text/xml')

		// Check for parsing errors
		const parserError = doc.querySelector('parsererror')
		if (parserError) {
			return {
				success: false,
				error: 'Invalid XML format. Please paste valid EVEMon skill plan XML.'
			}
		}

		// Find all entry elements
		const entries = doc.querySelectorAll('entry')
		if (entries.length === 0) {
			return {
				success: false,
				error: 'No skill entries found in the XML. Please ensure this is a valid EVEMon skill plan.'
			}
		}

		// Group entries by skill ID, tracking highest level and priority
		const skillMap = new Map<number, {
			name: string
			requiredLevel: number
			recommendedLevel: number
			highestPriority: number
		}>()

		entries.forEach((entry) => {
			const skillIdStr = entry.getAttribute('skillID')
			const levelStr = entry.getAttribute('level')
			const priorityStr = entry.getAttribute('priority')
			const skillName = entry.getAttribute('skill')

			if (!skillIdStr || !levelStr || !skillName) {
				return // Skip invalid entries
			}

			const skillId = parseInt(skillIdStr, 10)
			const level = parseInt(levelStr, 10)
			const priority = priorityStr ? parseInt(priorityStr, 10) : 3

			if (isNaN(skillId) || isNaN(level) || level < 1 || level > 5) {
				return // Skip invalid entries
			}

			const existing = skillMap.get(skillId)

			if (!existing) {
				// First entry for this skill
				const isPriority10 = priority === 10
				skillMap.set(skillId, {
					name: skillName,
					requiredLevel: isPriority10 ? 0 : level,  // Priority 10 = not required
					recommendedLevel: level,  // All priorities contribute to recommended
					highestPriority: priority
				})
			} else {
				// Update with higher level if found
				const isPriority10 = priority === 10

				if (!isPriority10) {
					// Priority 1-9: contributes to both required and recommended
					existing.requiredLevel = Math.max(existing.requiredLevel, level)
				}

				// All priorities (including 10) contribute to recommended
				existing.recommendedLevel = Math.max(existing.recommendedLevel, level)

				// Track the highest priority (lower number = higher priority)
				existing.highestPriority = Math.min(existing.highestPriority, priority)
			}
		})

		// Convert map to array
		const skills: ParsedEvemonSkill[] = []
		skillMap.forEach((data, skillId) => {
			skills.push({
				skillId,
				skillName: data.name,
				requiredLevel: data.requiredLevel,
				recommendedLevel: data.recommendedLevel,
				priority: data.highestPriority
			})
		})

		// Sort by priority then by name
		skills.sort((a, b) => {
			if (a.priority !== b.priority) {
				return a.priority - b.priority
			}
			return a.skillName.localeCompare(b.skillName)
		})

		return {
			success: true,
			skills
		}
	} catch (error) {
		console.error('Error parsing EVEMon XML:', error)
		return {
			success: false,
			error: 'Failed to parse XML. Please ensure the content is valid.'
		}
	}
}

/**
 * Format skill level display
 */
export function formatSkillLevel(level: number): string {
	const romans = ['', 'I', 'II', 'III', 'IV', 'V']
	return romans[level] || level.toString()
}