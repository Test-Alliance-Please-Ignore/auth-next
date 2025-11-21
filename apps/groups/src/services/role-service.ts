import { and, eq, inArray } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import { roleAttachments, roles } from '../db/schema'

import type {
	AttachRoleToRequest,
	BatchCreateRolesRequest,
	BatchGetRolesForRequest,
	CreateRoleRequest,
	DetachRoleFromRequest,
	GetRolesForRequest,
	ResourceType,
	Role,
	RoleAttachment,
	RoleAttachmentType,
} from '@repo/groups'
import type { ServiceContext } from './context'

export class RoleService {
	private readonly logger = logger.withTags({ service: 'groups-role-service' })

	constructor(private ctx: ServiceContext) {}

	async createRole(request: CreateRoleRequest): Promise<Role> {
		try {
			const role = await this.ctx.db.insert(roles).values(request).returning()
			if (!role) {
				throw new Error('Failed to create role')
			}
			return role[0] as Role
		} catch (error) {
			console.error('[RoleService.createRole] Failed to create role', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request,
			})
			throw error
		}
	}

	async batchCreateRoles(request: BatchCreateRolesRequest): Promise<Role[]> {
		try {
			const insertedRoles = await this.ctx.db.insert(roles).values(request.roles).returning()
			return insertedRoles.map((r) => r as Role)
		} catch (error) {
			console.error('[RoleService.batchCreateRoles] Failed to batch create roles', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request,
			})
			throw error
		}
	}

	async getRole(roleId: string): Promise<Role | null> {
		try {
			const role = await this.ctx.db.query.roles.findFirst({
				where: eq(roles.id, roleId),
			})
			return role as Role | null
		} catch (error) {
			console.error('[RoleService.getRole] Failed to get role', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				roleId,
			})
			throw error
		}
	}

	async getRoleByName(name: string): Promise<Role | null> {
		try {
			const role = await this.ctx.db.query.roles.findFirst({
				where: eq(roles.name, name),
			})
			return role as Role | null
		} catch (error) {
			console.error('[RoleService.getRoleByName] Failed to get role by name', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				name,
			})
			throw error
		}
	}

	async getRolesForOwnedBy(ownedBy: string): Promise<Role[]> {
		try {
			const foundRoles = await this.ctx.db.query.roles.findMany({
				where: eq(roles.ownedBy, ownedBy),
			})
			if (foundRoles.length === 0) {
				return []
			}
			return foundRoles.map((r) => r as Role)
		} catch (error) {
			console.error('[RoleService.getRolesForOwnedBy] Failed to get roles for owned by', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				ownedBy,
			})
			throw error
		}
	}

	async attachRoleTo(request: AttachRoleToRequest): Promise<RoleAttachment> {
		const role = await this.getRole(request.roleId)

		if (!role) {
			throw new Error(`Role not found: ${request.roleId}`)
		}
		try {
			const roleAttachment = await this.ctx.db.insert(roleAttachments).values(request).returning()
			if (!roleAttachment) {
				throw new Error('Failed to attach role to')
			}
			return {
				id: roleAttachment[0].id,
				role: role as Role,
				attachedToType: roleAttachment[0].attachedToType as RoleAttachmentType,
				attachedToId: roleAttachment[0].attachedToId,
				resourceId: roleAttachment[0].resourceId as string | undefined,
				resourceType: roleAttachment[0].resourceType as ResourceType | undefined,
				createdAt: roleAttachment[0].createdAt,
				updatedAt: roleAttachment[0].updatedAt,
			} as RoleAttachment
		} catch (error) {
			console.error('[RoleService.attachRoleTo] Failed to attach role to', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request,
			})
			throw error
		}
	}

	async detachRoleFrom(request: DetachRoleFromRequest): Promise<boolean> {
		try {
			const result = await this.ctx.db
				.delete(roleAttachments)
				.where(
					and(
						eq(roleAttachments.roleId, request.roleId),
						eq(roleAttachments.attachedToType, request.attachedToType),
						eq(roleAttachments.attachedToId, request.attachedToId)
					)
				)
			if (result.rowCount === 0) {
				return false
			}
			return true
		} catch (error) {
			console.error('[RoleService.detachRoleFrom] Failed to detatch role from', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request: request,
			})
			throw error
		}
	}

	async batchGetRolesFor(request: BatchGetRolesForRequest): Promise<RoleAttachment[]> {
		try {
			const foundRoles = await this.ctx.db.query.roleAttachments.findMany({
				where: and(
					eq(roleAttachments.attachedToType, request.attachedToType),
					inArray(roleAttachments.attachedToId, request.attachedToIds)
				),
				with: {
					role: true,
				},
			})
			if (foundRoles.length === 0) {
				return []
			}
			return foundRoles.map((r) => ({
				id: r.id,
				role: r.role as Role,
				attachedToType: r.attachedToType as RoleAttachmentType,
				attachedToId: r.attachedToId,
				resourceId: r.resourceId as string | undefined,
				resourceType: r.resourceType as ResourceType | undefined,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
			}))
		} catch (error) {
			console.error('[RoleService.batchGetRolesFor] Failed to get roles for', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request: request,
			})
			throw error
		}
	}

	async getRolesFor(request: GetRolesForRequest): Promise<RoleAttachment[]> {
		if (request.roleIds && request.roleId) {
			throw new Error('Cannot specify both roleIds and roleId')
		}
		if (request.roleIds && request.roleName) {
			throw new Error('Cannot specify both roleIds and roleName')
		}
		if (request.roleId && request.roleName) {
			throw new Error('Cannot specify both roleId and roleName')
		}
		const conditions = []
		if (request.roleIds) {
			conditions.push(inArray(roleAttachments.roleId, request.roleIds))
		}
		if (request.attachedToId) {
			conditions.push(eq(roleAttachments.attachedToId, request.attachedToId))
		}
		if (request.attachedToType) {
			conditions.push(eq(roleAttachments.attachedToType, request.attachedToType))
		}
		if (request.roleId) {
			conditions.push(eq(roleAttachments.roleId, request.roleId))
		}
		if (request.resourceId) {
			conditions.push(eq(roleAttachments.resourceId, request.resourceId))
		}
		if (request.resourceType) {
			conditions.push(eq(roleAttachments.resourceType, request.resourceType))
		}
		if (request.roleName) {
			this.logger.info('[RoleService.getRolesFor] Searching for roles attached to role name', {
				roleName: request.roleName,
			})
			const role = await this.getRoleByName(request.roleName)
			if (role) {
				conditions.push(eq(roleAttachments.roleId, role.id))
			} else {
				throw new Error(`Role not found: ${request.roleName}`)
			}
		}
		try {
			const foundRoleAttachments = await this.ctx.db.query.roleAttachments.findMany({
				where: and(...conditions),
				with: {
					role: true,
				},
			})

			this.logger.info('[RoleService.getRolesFor] Found roles', {
				foundRoleAttachments: foundRoleAttachments.length,
			})

			if (foundRoleAttachments.length === 0) {
				return []
			}

			return foundRoleAttachments.map((r) => ({
				id: r.id,
				role: r.role as Role,
				attachedToType: r.attachedToType as RoleAttachmentType,
				attachedToId: r.attachedToId,
				resourceId: r.resourceId as string | undefined,
				resourceType: r.resourceType as ResourceType | undefined,
				createdAt: r.createdAt,
				updatedAt: r.updatedAt,
			}))
		} catch (error) {
			console.error('[RoleService.getRolesFor] Failed to get roles for', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request: request,
			})
			throw error
		}
	}
}
