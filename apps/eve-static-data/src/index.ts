import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { useWorkersLogger } from 'workers-tagged-logger'
import { withNotFound, withOnError } from '@repo/hono-helpers'
import { eq, and, inArray } from 'drizzle-orm'
import type { App } from './context'
import { createDb } from './db'
import { schema } from './db/schema'

const app = new Hono<App>()
	.use('*', useWorkersLogger())
	.use('*', cors())
	.use('*', async (c, next) => {
		// Initialize database connection using Neon serverless
		const db = createDb(c.env.DATABASE_URL)
		c.set('db', db)
		await next()
	})
	.onError(withOnError())
	.notFound(withNotFound())

// Health check
app.get('/health', (c) => {
	return c.json({ status: 'ok' })
})

// Get all skill categories
app.get('/skills/categories', async (c) => {
	const db = c.get('db')
	const categories = await db.select().from(schema.skillCategories).orderBy(schema.skillCategories.name)
	return c.json(categories)
})

// Get skill groups in a category
app.get('/skills/categories/:categoryId/groups', async (c) => {
	const db = c.get('db')
	const categoryId = Number.parseInt(c.req.param('categoryId'))

	if (isNaN(categoryId)) {
		return c.json({ error: 'Invalid category ID' }, 400)
	}

	const groups = await db
		.select()
		.from(schema.skillGroups)
		.where(eq(schema.skillGroups.categoryId, categoryId))
		.orderBy(schema.skillGroups.name)

	return c.json(groups)
})

// Get all skill groups
app.get('/skills/groups', async (c) => {
	const db = c.get('db')
	const groups = await db.select().from(schema.skillGroups).orderBy(schema.skillGroups.name)
	return c.json(groups)
})

// Get skills in a group
app.get('/skills/groups/:groupId/skills', async (c) => {
	const db = c.get('db')
	const groupId = Number.parseInt(c.req.param('groupId'))

	if (isNaN(groupId)) {
		return c.json({ error: 'Invalid group ID' }, 400)
	}

	const skills = await db
		.select()
		.from(schema.skills)
		.where(and(eq(schema.skills.groupId, groupId), eq(schema.skills.published, true)))
		.orderBy(schema.skills.name)

	return c.json(skills)
})

// Get a specific skill by ID
app.get('/skills/:skillId', async (c) => {
	const db = c.get('db')
	const skillId = Number.parseInt(c.req.param('skillId'))

	if (isNaN(skillId)) {
		return c.json({ error: 'Invalid skill ID' }, 400)
	}

	const [skill] = await db.select().from(schema.skills).where(eq(schema.skills.id, skillId))

	if (!skill) {
		return c.json({ error: 'Skill not found' }, 404)
	}

	// Also fetch requirements for this skill
	const requirements = await db
		.select({
			requiredSkillId: schema.skillRequirements.requiredSkillId,
			requiredLevel: schema.skillRequirements.requiredLevel,
			requiredSkillName: schema.skills.name,
		})
		.from(schema.skillRequirements)
		.leftJoin(schema.skills, eq(schema.skills.id, schema.skillRequirements.requiredSkillId))
		.where(eq(schema.skillRequirements.skillId, skillId))

	return c.json({
		...skill,
		requirements,
	})
})

// Get all skills with category and group information
app.get('/skills', async (c) => {
	const db = c.get('db')

	// Support filtering by multiple skill IDs
	const skillIdsParam = c.req.query('ids')
	const publishedOnly = c.req.query('published') !== 'false'

	const skillIds = skillIdsParam ? skillIdsParam.split(',').map(Number).filter(id => !isNaN(id)) : []

	let skills = []

	// If we have a large number of skill IDs (>10), batch the queries to avoid parameter limits
	// Neon HTTP has a strict parameter limit, use 10 to be safe (10 IDs + 1 for published flag = 11 params)
	if (skillIds.length > 10) {
		const BATCH_SIZE = 10
		for (let i = 0; i < skillIds.length; i += BATCH_SIZE) {
			const batch = skillIds.slice(i, i + BATCH_SIZE)

			const conditions = [inArray(schema.skills.id, batch)]
			if (publishedOnly) {
				conditions.push(eq(schema.skills.published, true))
			}

			const batchSkills = await db
				.select({
					id: schema.skills.id,
					name: schema.skills.name,
					description: schema.skills.description,
					rank: schema.skills.rank,
					primaryAttribute: schema.skills.primaryAttribute,
					secondaryAttribute: schema.skills.secondaryAttribute,
					published: schema.skills.published,
					canNotBeTrained: schema.skills.canNotBeTrained,
					groupId: schema.skills.groupId,
					groupName: schema.skillGroups.name,
				})
				.from(schema.skills)
				.leftJoin(schema.skillGroups, eq(schema.skills.groupId, schema.skillGroups.id))
				.where(and(...conditions))

			skills.push(...batchSkills)
		}

		// Sort the combined results
		skills.sort((a, b) => {
			if (a.groupName !== b.groupName) return (a.groupName || '').localeCompare(b.groupName || '')
			return a.name.localeCompare(b.name)
		})
	} else {
		// For smaller queries, use the original approach
		let query = db
			.select({
				id: schema.skills.id,
				name: schema.skills.name,
				description: schema.skills.description,
				rank: schema.skills.rank,
				primaryAttribute: schema.skills.primaryAttribute,
				secondaryAttribute: schema.skills.secondaryAttribute,
				published: schema.skills.published,
				canNotBeTrained: schema.skills.canNotBeTrained,
				groupId: schema.skills.groupId,
				groupName: schema.skillGroups.name,
			})
			.from(schema.skills)
			.leftJoin(schema.skillGroups, eq(schema.skills.groupId, schema.skillGroups.id))

		// Apply filters
		const conditions = []
		if (publishedOnly) {
			conditions.push(eq(schema.skills.published, true))
		}

		if (skillIds.length > 0) {
			conditions.push(inArray(schema.skills.id, skillIds))
		}

		if (conditions.length > 0) {
			query = query.where(and(...conditions))
		}

		skills = await query.orderBy(schema.skillGroups.name, schema.skills.name)
	}

	// Group by skill group (what players think of as "categories")
	// Since all skills have the same item category "Skill", we use groups as top-level
	const grouped = skills.reduce((acc, skill) => {
		const groupId = skill.groupId || 0
		const groupName = skill.groupName || 'Unknown'

		if (!acc[groupId]) {
			acc[groupId] = {
				categoryId: groupId, // Using groupId as categoryId for UI compatibility
				categoryName: groupName,
				groups: [{
					groupId: groupId,
					groupName: groupName,
					skills: [],
				}],
			}
		}

		acc[groupId].groups[0].skills.push({
			id: skill.id,
			name: skill.name,
			description: skill.description,
			rank: skill.rank,
			primaryAttribute: skill.primaryAttribute,
			secondaryAttribute: skill.secondaryAttribute,
			published: skill.published,
			canNotBeTrained: skill.canNotBeTrained,
		})

		return acc
	}, {} as Record<number, any>)

	// Convert to array format
	const result = Object.values(grouped)

	return c.json(result)
})

// Get skill requirements for multiple skills
app.post('/skills/requirements', async (c) => {
	const db = c.get('db')
	const { skillIds } = await c.req.json<{ skillIds: number[] }>()

	if (!skillIds || !Array.isArray(skillIds)) {
		return c.json({ error: 'Invalid request body' }, 400)
	}

	const validSkillIds = skillIds.filter(id => !isNaN(id))
	if (validSkillIds.length === 0) {
		return c.json([])
	}

	const requirements = await db
		.select({
			skillId: schema.skillRequirements.skillId,
			requiredSkillId: schema.skillRequirements.requiredSkillId,
			requiredLevel: schema.skillRequirements.requiredLevel,
			requiredSkillName: schema.skills.name,
		})
		.from(schema.skillRequirements)
		.leftJoin(schema.skills, eq(schema.skills.id, schema.skillRequirements.requiredSkillId))
		.where(inArray(schema.skillRequirements.skillId, validSkillIds))

	// Group by skill ID
	const grouped = requirements.reduce((acc, req) => {
		if (!acc[req.skillId]) {
			acc[req.skillId] = []
		}
		acc[req.skillId].push({
			requiredSkillId: req.requiredSkillId,
			requiredLevel: req.requiredLevel,
			requiredSkillName: req.requiredSkillName,
		})
		return acc
	}, {} as Record<number, any[]>)

	return c.json(grouped)
})

// Get SDE version info
app.get('/sde/version', async (c) => {
	const db = c.get('db')
	const [version] = await db.select().from(schema.sdeVersion).orderBy(schema.sdeVersion.importedAt).limit(1)

	if (!version) {
		return c.json({ error: 'No SDE data imported' }, 404)
	}

	return c.json(version)
})

export default app