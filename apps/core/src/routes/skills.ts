import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'

import { requireAuth } from '../middleware/session'

import type { Skills } from '@repo/skills'
import type { App } from '../context'

/**
 * Skills routes
 *
 * Uses the Skills Durable Object for skill data with heavy caching
 */
const skills = new Hono<App>()

// Require authentication for all skills endpoints
skills.use('*', requireAuth())

/**
 * GET /api/skills
 * Get all available skills with group information
 * Query params:
 * - ids: Comma-separated list of skill IDs (returns categorized format)
 * - search: Search query for skill names
 * - limit: Maximum number of results (for search)
 * - includeUnpublished: Whether to include unpublished skills (admin only)
 */
skills.get('/', async (c) => {
	const query = c.req.query()
	const ids = query.ids
	const search = query.search
	const limit = query.limit ? parseInt(query.limit, 10) : 50
	const includeUnpublished = query.includeUnpublished === 'true'

	const user = c.get('user')!

	// Only admins can view unpublished skills
	if (includeUnpublished && !user.is_admin) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

	try {
		// Handle skill IDs request (for character skills display)
		if (ids) {
			const skillIds = ids.split(',').filter((id) => id.trim())

			// Fetch all the requested skills with metadata (category, group info)
			const skills = await skillsStub.getSkillsMetadata(skillIds)

			// Organize by category and group
			const categoriesMap = new Map<
				number,
				{
					categoryId: number
					categoryName: string
					groups: Map<
						number,
						{
							groupId: number
							groupName: string
							skills: any[]
						}
					>
				}
			>()

			for (const skill of skills) {
				// Use categoryId and categoryName from skill metadata
				const categoryId = skill.categoryId || 0
				const categoryName = skill.categoryName || 'Unknown'
				const groupId = skill.groupId || 0
				const groupName = skill.groupName || 'Unknown'

				if (!categoriesMap.has(categoryId)) {
					categoriesMap.set(categoryId, {
						categoryId,
						categoryName,
						groups: new Map(),
					})
				}

				const category = categoriesMap.get(categoryId)!
				if (!category.groups.has(groupId)) {
					category.groups.set(groupId, {
						groupId,
						groupName,
						skills: [],
					})
				}

				category.groups.get(groupId)!.skills.push({
					id: skill.id,
					name: skill.name,
					description: skill.description,
					rank: skill.rank,
					primaryAttribute: skill.primaryAttribute,
					secondaryAttribute: skill.secondaryAttribute,
				})
			}

			// Convert to array format
			const categories = Array.from(categoriesMap.values()).map((cat) => ({
				categoryId: cat.categoryId,
				categoryName: cat.categoryName,
				groups: Array.from(cat.groups.values()),
			}))

			return c.json(categories)
		}

		if (search && search.trim().length >= 2) {
			// Search for skills
			const results = await skillsStub.searchSkills(search, limit)
			return c.json(results)
		} else {
			// Get all skills
			const allSkills = await skillsStub.getAllSkills(includeUnpublished)
			return c.json(allSkills)
		}
	} catch (error) {
		console.error('Failed to get skills:', error)
		return c.json({ error: 'Failed to get skills' }, 500)
	}
})

/**
 * GET /api/skills/groups
 * Get all skill groups
 */
skills.get('/groups', async (c) => {
	const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

	try {
		// For now, we'll get all skills and extract unique groups
		// In the future, we could add a dedicated method for this
		const allSkills = await skillsStub.getAllSkills()
		const groups = [...new Set(allSkills.map((s) => s.groupName))].filter((g) => g !== 'Unknown')

		// Return as an array of group objects for future extensibility
		const groupData = groups.sort().map((name) => ({
			id: name.toLowerCase().replace(/\s+/g, '-'),
			name,
			skillCount: allSkills.filter((s) => s.groupName === name).length,
		}))

		return c.json(groupData)
	} catch (error) {
		console.error('Failed to get skill groups:', error)
		return c.json({ error: 'Failed to get skill groups' }, 500)
	}
})

/**
 * GET /api/skills/group/:groupId
 * Get all skills in a specific group
 */
skills.get('/group/:groupId', async (c) => {
	const groupId = c.req.param('groupId')
	const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

	try {
		const skillsInGroup = await skillsStub.getSkillsByGroupId(groupId as any)
		return c.json(skillsInGroup)
	} catch (error) {
		console.error('Failed to get skills for group:', error)
		return c.json({ error: 'Failed to get skills for group' }, 500)
	}
})

/**
 * GET /api/skills/:skillId
 * Get a specific skill by ID
 */
skills.get('/:skillId', async (c) => {
	const skillId = c.req.param('skillId')
	const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

	try {
		const skill = await skillsStub.getSkillInfo(skillId as any)
		if (!skill) {
			return c.json({ error: 'Skill not found' }, 404)
		}
		return c.json(skill)
	} catch (error) {
		console.error('Failed to get skill:', error)
		return c.json({ error: 'Failed to get skill' }, 500)
	}
})

/**
 * POST /api/skills/cache/clear
 * Clear all skill caches (admin only)
 * Useful for forcing a refresh after skill data updates
 */
skills.post('/cache/clear', async (c) => {
	const user = c.get('user')!

	if (!user.is_admin) {
		return c.json({ error: 'Permission denied' }, 403)
	}

	const skillsStub = getStub<Skills>(c.env.SKILLS, 'default')

	try {
		await skillsStub.clearAllCaches()
		return c.json({ message: 'All skill caches cleared successfully' })
	} catch (error) {
		console.error('Failed to clear caches:', error)
		return c.json({ error: 'Failed to clear caches' }, 500)
	}
})

export default skills
