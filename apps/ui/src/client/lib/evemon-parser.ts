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
 * Takes the highest level for each skill as required
 * Priority 1-3 considered required, 4-5 considered recommended
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
				const isRequired = priority <= 3
				skillMap.set(skillId, {
					name: skillName,
					requiredLevel: isRequired ? level : 0,
					recommendedLevel: !isRequired ? level : 0,
					highestPriority: priority
				})
			} else {
				// Update with higher level if found
				const isRequired = priority <= 3

				if (isRequired) {
					// Take the highest required level
					existing.requiredLevel = Math.max(existing.requiredLevel, level)
				} else {
					// Take the highest recommended level
					existing.recommendedLevel = Math.max(existing.recommendedLevel, level)
				}

				// Track the highest priority (lower number = higher priority)
				existing.highestPriority = Math.min(existing.highestPriority, priority)
			}
		})

		// Convert map to array
		const skills: ParsedEvemonSkill[] = []
		skillMap.forEach((data, skillId) => {
			// If we have both required and recommended, and recommended is higher,
			// make it all required (as per user preference to take highest as required)
			const finalRequiredLevel = Math.max(data.requiredLevel, data.recommendedLevel)

			skills.push({
				skillId,
				skillName: data.name,
				requiredLevel: finalRequiredLevel,
				recommendedLevel: finalRequiredLevel, // Set same as required to satisfy API validation
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