import { and, desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { hrRoles } from '../db/schema'

import type { HrRole, HrRoleType, RoleFilters } from '@repo/hr'
import type { DbClient } from '@repo/db-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type * as schema from '../db/schema'

/**
 * HR Roles Service
 *
 * Manages HR role assignments for corporations.
 * Validates corporation membership via EVE Corporation Data DO.
 */
export class HrRoleService {
	constructor(private db: DbClient<typeof schema>) {}

	/**
	 * Role hierarchy for permission checks
	 * Higher value = more permissions
	 */
	private readonly roleHierarchy: Record<HrRoleType, number> = {
		hr_viewer: 1,
		hr_reviewer: 2,
		hr_admin: 3,
	}

	/**
	 * Grant an HR role to a user for a corporation
	 * Validates that the character is a member of the corporation
	 */
	async grantRole(
		corporationId: string,
		userId: string,
		characterId: string,
		characterName: string,
		role: HrRoleType,
		grantedBy: string,
		eveCorporationDataNamespace: DurableObjectNamespace,
		expiresAt?: Date
	): Promise<HrRole> {
		// Validate corporation membership via EVE Corporation Data DO
		const corpStub = getStub<EveCorporationData>(eveCorporationDataNamespace, corporationId)
		const members = await corpStub.getMembers(corporationId)
		const isMember = members.some((m) => m.characterId === characterId)

		if (!isMember) {
			throw new Error(
				`Character ${characterId} is not a member of corporation ${corporationId}`
			)
		}

		// Check for existing active role
		const existing = await this.db.query.hrRoles.findFirst({
			where: and(
				eq(hrRoles.corporationId, corporationId),
				eq(hrRoles.userId, userId),
				eq(hrRoles.isActive, true)
			),
		})

		// If exists, deactivate the old one (partial unique constraint allows this)
		if (existing) {
			await this.db
				.update(hrRoles)
				.set({ isActive: false, updatedAt: new Date() })
				.where(eq(hrRoles.id, existing.id))
		}

		// Create the new role
		const [hrRole] = await this.db
			.insert(hrRoles)
			.values({
				corporationId,
				userId,
				characterId,
				characterName,
				role,
				grantedBy,
				expiresAt: expiresAt || null,
				isActive: true,
			})
			.returning()

		if (!hrRole) {
			throw new Error('Failed to grant HR role')
		}

		return this.mapToHrRole(hrRole)
	}

	/**
	 * Revoke an HR role (set to inactive)
	 */
	async revokeRole(roleId: string): Promise<void> {
		// Get the role to verify it exists
		const role = await this.db.query.hrRoles.findFirst({
			where: eq(hrRoles.id, roleId),
		})

		if (!role) {
			throw new Error('HR role not found')
		}

		// Deactivate the role
		await this.db
			.update(hrRoles)
			.set({ isActive: false, updatedAt: new Date() })
			.where(eq(hrRoles.id, roleId))
	}

	/**
	 * Get a single HR role by ID
	 */
	async getRole(roleId: string): Promise<HrRole | null> {
		const role = await this.db.query.hrRoles.findFirst({
			where: eq(hrRoles.id, roleId),
		})

		if (!role) {
			return null
		}

		return this.mapToHrRole(role)
	}

	/**
	 * Get HR roles for a user
	 */
	async getUserRoles(userId: string, corporationId?: string): Promise<HrRole[]> {
		const conditions = [eq(hrRoles.userId, userId), eq(hrRoles.isActive, true)]

		if (corporationId) {
			conditions.push(eq(hrRoles.corporationId, corporationId))
		}

		const results = await this.db.query.hrRoles.findMany({
			where: and(...conditions),
			orderBy: [desc(hrRoles.grantedAt)],
		})

		return results.map((role) => this.mapToHrRole(role))
	}

	/**
	 * Get all HR roles for a corporation
	 */
	async getCorporationRoles(corporationId: string, activeOnly = true): Promise<HrRole[]> {
		const conditions = [eq(hrRoles.corporationId, corporationId)]

		if (activeOnly) {
			conditions.push(eq(hrRoles.isActive, true))
		}

		const results = await this.db.query.hrRoles.findMany({
			where: and(...conditions),
			orderBy: [desc(hrRoles.grantedAt)],
		})

		return results.map((role) => this.mapToHrRole(role))
	}

	/**
	 * List HR roles with optional filters
	 */
	async listRoles(filters: RoleFilters): Promise<HrRole[]> {
		const conditions: ReturnType<typeof and>[] = []

		if (filters.corporationId) {
			conditions.push(eq(hrRoles.corporationId, filters.corporationId))
		}

		if (filters.userId) {
			conditions.push(eq(hrRoles.userId, filters.userId))
		}

		if (filters.isActive !== undefined) {
			conditions.push(eq(hrRoles.isActive, filters.isActive))
		}

		const results = await this.db.query.hrRoles.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(hrRoles.grantedAt)],
			limit: filters.limit || 50,
			offset: filters.offset || 0,
		})

		return results.map((role) => this.mapToHrRole(role))
	}

	/**
	 * Check if a user has permission for a corporation
	 * Returns true if user has at least the required role level
	 */
	async checkPermission(
		userId: string,
		corporationId: string,
		requiredRole: HrRoleType
	): Promise<boolean> {
		const role = await this.db.query.hrRoles.findFirst({
			where: and(
				eq(hrRoles.userId, userId),
				eq(hrRoles.corporationId, corporationId),
				eq(hrRoles.isActive, true)
			),
		})

		if (!role) {
			return false
		}

		// Check if role is expired
		if (role.expiresAt && role.expiresAt < new Date()) {
			return false
		}

		// Check role hierarchy
		const userRoleLevel = this.roleHierarchy[role.role as HrRoleType]
		const requiredLevel = this.roleHierarchy[requiredRole]

		return userRoleLevel >= requiredLevel
	}

	/**
	 * Get corporations where user has HR access
	 */
	async getUserHrCorporations(userId: string): Promise<string[]> {
		const results = await this.db.query.hrRoles.findMany({
			where: and(eq(hrRoles.userId, userId), eq(hrRoles.isActive, true)),
		})

		// Filter out expired roles
		const now = new Date()
		const activeCorporations = results
			.filter((role) => !role.expiresAt || role.expiresAt > now)
			.map((role) => role.corporationId)

		// Return unique corporation IDs
		return [...new Set(activeCorporations)]
	}

	/**
	 * Find expired roles (for cleanup job)
	 */
	async findExpiredRoles(): Promise<HrRole[]> {
		const now = new Date()

		const results = await this.db.query.hrRoles.findMany({
			where: and(eq(hrRoles.isActive, true), eq(hrRoles.expiresAt, now)),
		})

		// Additional filter for expired roles (partial index might not catch all)
		const expired = results.filter((role) => role.expiresAt && role.expiresAt < now)

		return expired.map((role) => this.mapToHrRole(role))
	}

	/**
	 * Map database record to HrRole DTO
	 */
	private mapToHrRole(role: typeof hrRoles.$inferSelect): HrRole {
		return {
			id: role.id,
			corporationId: role.corporationId,
			userId: role.userId,
			characterId: role.characterId,
			characterName: role.characterName,
			role: role.role as HrRoleType,
			grantedBy: role.grantedBy,
			grantedAt: role.grantedAt,
			expiresAt: role.expiresAt,
			isActive: role.isActive,
			createdAt: role.createdAt,
			updatedAt: role.updatedAt,
		}
	}
}
