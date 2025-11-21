import { and, eq, inArray } from '@repo/db-utils'
import type {
	Category,
	CategoryWithGroups,
	CreateCategoryRequest,
	UpdateCategoryRequest,
} from '@repo/groups'
import { categories, groupMembers } from '../db/schema'
import { mapCategory, mapGroup } from './mappers'
import { canViewCategory, canViewGroup } from './permissions'

import type { ServiceContext } from './context'

export class CategoryService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * Invalidate the categories cache in Workers KV
	 */
	private async invalidateCategoriesCache(): Promise<void> {
		const cacheKey = 'categories:all:v1'
		await this.ctx.env.GROUPS_KV?.delete(cacheKey)
	}

	async createCategory(data: CreateCategoryRequest, adminUserId: string): Promise<Category> {
		// Admin-only operation - validation should happen before calling this

		const [category] = await this.ctx.db
			.insert(categories)
			.values({
				name: data.name,
				description: data.description || null,
				visibility: data.visibility || 'public',
				allowGroupCreation: data.allowGroupCreation || 'anyone',
			})
			.returning()

		// Invalidate categories cache
		await this.invalidateCategoriesCache()

		return mapCategory(category)
	}

	async listCategories(userId: string, isAdmin: boolean): Promise<Category[]> {
		// Try to get from KV cache first
		const cacheKey = 'categories:all:v1'
		const cached = await this.ctx.env.GROUPS_KV?.get(cacheKey, { type: 'json' })

		let allCategories: Array<typeof categories.$inferSelect>

		if (cached) {
			allCategories = cached as Array<typeof categories.$inferSelect>
		} else {
			// Cache miss - fetch from database
			allCategories = await this.ctx.db.query.categories.findMany({
				orderBy: (categories, { asc }) => [asc(categories.name)],
			})

			// Store in KV with 1 hour TTL
			await this.ctx.env.GROUPS_KV?.put(cacheKey, JSON.stringify(allCategories), {
				expirationTtl: 3600,
			})
		}

		// Filter based on permissions (user-specific, so always done after caching)
		const visible = allCategories.filter((cat) => canViewCategory(cat, userId, isAdmin))

		return visible.map(mapCategory)
	}

	async getCategory(
		id: string,
		userId: string,
		isAdmin: boolean
	): Promise<CategoryWithGroups | null> {
		const category = await this.ctx.db.query.categories.findFirst({
			where: eq(categories.id, id),
			with: {
				groups: true,
			},
		})

		if (!category) return null

		// Check if user can view this category
		if (!canViewCategory(category, userId, isAdmin)) {
			return null
		}

		// Batch fetch user memberships for all groups in this category
		const groupIds = category.groups.map((g) => g.id)
		const memberships =
			groupIds.length > 0
				? await this.ctx.db.query.groupMembers.findMany({
						where: and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, groupIds)),
					})
				: []
		const memberGroupIds = new Set(memberships.map((m) => m.groupId))

		// Filter groups based on user permissions
		const visibleGroups = category.groups
			.filter((group) => {
				const isMember = memberGroupIds.has(group.id)
				return canViewGroup(group, userId, isAdmin, isMember)
			})
			.map((group) => mapGroup(group))

		return {
			...mapCategory(category),
			groups: visibleGroups,
			groupCount: visibleGroups.length,
		}
	}

	async updateCategory(
		id: string,
		data: UpdateCategoryRequest,
		adminUserId: string
	): Promise<Category> {
		// Admin-only operation

		const updates: Partial<typeof categories.$inferInsert> = {}

		if (data.name !== undefined) updates.name = data.name
		if (data.description !== undefined) updates.description = data.description
		if (data.visibility !== undefined) updates.visibility = data.visibility
		if (data.allowGroupCreation !== undefined) updates.allowGroupCreation = data.allowGroupCreation

		updates.updatedAt = new Date()

		const [updated] = await this.ctx.db
			.update(categories)
			.set(updates)
			.where(eq(categories.id, id))
			.returning()

		if (!updated) {
			throw new Error('Category not found')
		}

		// Invalidate categories cache
		await this.invalidateCategoriesCache()

		return mapCategory(updated)
	}

	async deleteCategory(id: string, adminUserId: string): Promise<void> {
		// Admin-only operation
		// CASCADE will delete all groups in this category and their relations
		await this.ctx.db.delete(categories).where(eq(categories.id, id))

		// Invalidate categories cache
		await this.invalidateCategoriesCache()
	}
}
