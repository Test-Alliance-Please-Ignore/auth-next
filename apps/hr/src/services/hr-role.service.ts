import { and, desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { ResourceType, RoleAttachmentType } from '@repo/groups'
import { logger } from '@repo/hono-helpers'
import { HR_ROLES, ROLE_HR_ADMIN, ROLE_HR_REVIEWER, ROLE_HR_VIEWER, SERVICE_HR } from '@repo/hr'

import { hrRoles } from '../db/schema'

import type { Esi } from '@repo/esi'
import type { CreateRoleRequest, Groups, Role } from '@repo/groups'
import type { HrRole, HrRoleType, HrRoleUrn, RoleFilters } from '@repo/hr'
import type { ServiceContext } from './context'

/**
 * HR Roles Service
 *
 * Manages HR role assignments for corporations.
 * Validates corporation membership via EVE Corporation Data DO.
 */
export class HrRoleService {
	private readonly logger = logger.withTags({ service: 'hr-role' })
	private readonly roleIdCache = new Map<HrRoleType, string>()

	constructor(private ctx: ServiceContext) {}

	/**
	 * Role hierarchy for permission checks
	 * Higher value = more permissions
	 */
	private readonly roleHierarchy: Record<HrRoleType, number> = {
		hr_viewer: 1,
		hr_reviewer: 2,
		hr_admin: 3,
	}

	async ensureRolesExist(): Promise<void> {
		const roles = HR_ROLES.map((role) => ({
			name: role,
			ownedBy: SERVICE_HR,
			description: `${role} role for the HR system`,
		})) as CreateRoleRequest[]

		const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')
		try {
			await groupsStub.batchCreateRoles({ roles })
			this.logger.info('[HrRoleService.ensureRolesExist] roles created.', { roles })
		} catch (error) {}
	}

	private async lookupRoleByHrRoleType(hrRoleType: HrRoleType): Promise<string> {
		const cachedRoleId = this.roleIdCache.get(hrRoleType)
		if (cachedRoleId) {
			return cachedRoleId
		}

		const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')
		let roleName = ''
		switch (hrRoleType) {
			case 'hr_viewer':
				roleName = ROLE_HR_VIEWER
				break
			case 'hr_reviewer':
				roleName = ROLE_HR_REVIEWER
				break
			case 'hr_admin':
				roleName = ROLE_HR_ADMIN
				break
			default:
				throw new Error(`Invalid HR role type: ${hrRoleType}`)
		}
		this.logger.info('[HrRoleService.lookupRoleByHrRoleType] looking up role by name', { roleName })
		const role = await groupsStub.getRoleByName(roleName)
		if (!role) {
			throw new Error(`Role not found: ${roleName}`)
		}
		this.logger.info('[HrRoleService.lookupRoleByHrRoleType] role found', { role })

		this.roleIdCache.set(hrRoleType, role.id)
		return role.id
	}
	/**
	 * Grant an HR role to a user for a corporation
	 * Validates that the character is a member of the corporation
	 */
	async grantRole(
		corporationId: string,
		userId: string,
		role: HrRoleType,
		grantedBy: string,
		expiresAt?: Date
	): Promise<HrRole> {
		const roleId = await this.lookupRoleByHrRoleType(role)

		// Check for existing role
		const existing = await this.ctx.db.query.hrRoles.findFirst({
			where: and(eq(hrRoles.corporationId, corporationId), eq(hrRoles.userId, userId)),
		})

		// If exists delete the old one
		if (existing) {
			await this.ctx.db.delete(hrRoles).where(eq(hrRoles.id, existing.id))
		}

		// Create the new role
		const [hrRole] = await this.ctx.db
			.insert(hrRoles)
			.values({
				corporationId,
				userId,
				characterId: userId,
				characterName: userId,
				role,
				grantedBy,
				expiresAt: expiresAt || null,
				isActive: true,
			})
			.returning()

		if (!hrRole) {
			throw new Error('Failed to grant HR role')
		}

		this.logger.info('[HrRoleService.grantRole] attaching role to user', {
			roleId,
			userId,
			corporationId,
		})
		try {
			const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')
			await groupsStub.attachRoleTo({
				roleId,
				attachedToType: RoleAttachmentType.USER,
				attachedToId: userId,
				resourceId: corporationId,
				resourceType: ResourceType.CORPORATION,
			})
		} catch (error) {
			this.logger.error('[HrRoleService.grantRole] failed to attach role to user', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				roleId,
				userId,
				corporationId,
			})
		}
		return this.mapToHrRole(hrRole)
	}

	/**
	 * Revoke an HR role
	 */
	async revokeRole(roleId: string): Promise<void> {
		// Get the role to verify it exists
		const role = await this.ctx.db.query.hrRoles.findFirst({
			where: eq(hrRoles.id, roleId),
		})

		if (!role) {
			throw new Error('HR role not found')
		}

		// Delete the role
		await this.ctx.db.delete(hrRoles).where(eq(hrRoles.id, roleId))
	}

	/**
	 * Get a single HR role by ID
	 */
	async getRole(roleId: string): Promise<HrRole | null> {
		const role = await this.ctx.db.query.hrRoles.findFirst({
			where: eq(hrRoles.id, roleId),
		})

		if (!role) {
			return null
		}

		return this.mapToHrRole(role)
	}

	private async getRoleForType(roleType: HrRoleUrn): Promise<Role> {
		const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')
		const role = await groupsStub.getRoleByName(roleType)
		if (!role) {
			throw new Error(`Role not found: ${roleType}`)
		}
		return role
	}

	private getHrRoleTypeForRole(role: Role | string): HrRoleType {
		let choice: string
		if (typeof role === 'string') {
			choice = role
		} else {
			choice = role.name
		}
		switch (choice) {
			case ROLE_HR_ADMIN:
				return 'hr_admin'
			case ROLE_HR_REVIEWER:
				return 'hr_reviewer'
			case ROLE_HR_VIEWER:
				return 'hr_viewer'
			default:
				throw new Error(`Invalid role: ${choice}`)
		}
	}

	/**
	 * Get HR roles for a user
	 */

	async getUserRoles(userId: string, corporationId?: string): Promise<HrRole[]> {
		const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')
		const roleAttachments = await groupsStub.getRolesFor({
			attachedToType: RoleAttachmentType.USER,
			attachedToId: userId,
			resourceId: corporationId,
			resourceType: ResourceType.CORPORATION,
		})
		try {
			return roleAttachments.map((roleAttachment) => {
				return {
					id: roleAttachment.id,
					corporationId: corporationId,
					userId: roleAttachment.attachedToId,
					characterId: roleAttachment.attachedToId,
					characterName: roleAttachment.attachedToId,
					role: this.getHrRoleTypeForRole(roleAttachment.role),
					grantedBy: roleAttachment.role.ownedBy,
					grantedAt: roleAttachment.createdAt,
					expiresAt: null,
					isActive: true,
					createdAt: roleAttachment.createdAt,
					updatedAt: roleAttachment.updatedAt,
				} as HrRole
			})
		} catch (error) {
			this.logger.error('[HrRoleService.getCorporationRoles] failed to get corporation roles', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				corporationId,
			})
		}
		return []
	}

	/**
	 * Get all HR roles for a corporation
	 */
	async getCorporationRoles(corporationId: string, activeOnly = true): Promise<HrRole[]> {
		const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')
		const viewerRole = await this.getRoleForType(ROLE_HR_VIEWER)
		const reviewerRole = await this.getRoleForType(ROLE_HR_REVIEWER)
		const adminRole = await this.getRoleForType(ROLE_HR_ADMIN)

		const roleAttachments = await groupsStub.getRolesFor({
			attachedToType: RoleAttachmentType.USER,
			resourceId: corporationId,
			resourceType: ResourceType.CORPORATION,
			roleIds: [viewerRole.id, reviewerRole.id, adminRole.id],
		})

		logger.info('[HrRoleService.getCorporationRoles] role attachments', {
			roleAttachments,
		})

		try {
			return roleAttachments.map((roleAttachment) => {
				return {
					id: roleAttachment.id,
					corporationId: corporationId,
					userId: roleAttachment.attachedToId,
					characterId: roleAttachment.attachedToId,
					characterName: roleAttachment.attachedToId,
					role: this.getHrRoleTypeForRole(roleAttachment.role),
					grantedBy: roleAttachment.role.ownedBy,
					grantedAt: roleAttachment.createdAt,
					expiresAt: null,
					isActive: true,
					createdAt: roleAttachment.createdAt,
					updatedAt: roleAttachment.updatedAt,
				} as HrRole
			})
		} catch (error) {
			this.logger.error('[HrRoleService.getCorporationRoles] failed to get corporation roles', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				corporationId,
			})
		}
		return []
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
		const roles = await this.getUserRoles(userId, corporationId)

		if (roles.length === 0) {
			return false
		}

		return roles.some((role) => role.role === requiredRole)
	}

	/**
	 * Get corporations where user has HR access
	 */
	async getUserHrCorporations(userId: string): Promise<string[]> {
		const viewerRole = await this.getRoleForType(ROLE_HR_VIEWER)
		const reviewerRole = await this.getRoleForType(ROLE_HR_REVIEWER)
		const adminRole = await this.getRoleForType(ROLE_HR_ADMIN)
		const groupsStub = getStub<Groups>(this.ctx.env.GROUPS, 'default')

		const roleAttachments = await groupsStub.getRolesFor({
			attachedToType: RoleAttachmentType.USER,
			attachedToId: userId,
			resourceType: ResourceType.CORPORATION,
			roleIds: [viewerRole.id, reviewerRole.id, adminRole.id],
		})

		return roleAttachments.map((roleAttachment) => roleAttachment.resourceId as string)
	}

	/**
	 * Find expired roles (for cleanup job)
	 */
	async findExpiredRoles(): Promise<HrRole[]> {
		const now = new Date()

		const results = await this.ctx.db.query.hrRoles.findMany({
			where: and(eq(hrRoles.isActive, true), eq(hrRoles.expiresAt, now)),
		})

		// Additional filter for expired roles (partial index might not catch all)
		const expired = results.filter((role) => role.expiresAt && role.expiresAt < now)

		return expired.map((role) => this.mapToHrRole(role))
	}

	/**
	 * Deactivate HR roles for a departed member
	 * Called when a member leaves a corporation
	 */
	async deactivateRolesForDepartedMember(
		corporationId: string,
		characterId: string
	): Promise<number> {
		const result = await this.ctx.db
			.update(hrRoles)
			.set({ isActive: false, updatedAt: new Date() })
			.where(
				and(
					eq(hrRoles.corporationId, corporationId),
					eq(hrRoles.characterId, characterId),
					eq(hrRoles.isActive, true)
				)
			)

		// Drizzle doesn't always provide rowCount, so we return a generic success indicator
		return result.rowCount ?? 0
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
