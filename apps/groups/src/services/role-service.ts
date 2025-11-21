import { and, eq, inArray } from '@repo/db-utils'

import { roleAttachments, roles } from '../db/schema'

import type {
	AttachRoleToRequest,
	BatchGetRolesForRequest,
	CreateRoleRequest,
	DetachRoleFromRequest,
	GetRolesForRequest,
	Role,
	RoleAttachment,
} from '@repo/groups'
import type { ServiceContext } from './context'

export class RoleService {
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
		try {
			const roleAttachment = await this.ctx.db.insert(roleAttachments).values(request).returning()
			if (!roleAttachment) {
				throw new Error('Failed to attach role to')
			}
			return roleAttachment[0] as RoleAttachment
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

	async batchGetRolesFor(request: BatchGetRolesForRequest): Promise<Role[]> {
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
			return foundRoles.map((r) => r.role)
		} catch (error) {
			console.error('[RoleService.batchGetRolesFor] Failed to get roles for', {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				request: request,
			})
			throw error
		}
	}

	async getRolesFor(request: GetRolesForRequest): Promise<Role[]> {
		try {
			const foundRoles = await this.ctx.db.query.roleAttachments.findMany({
				where: and(
					eq(roleAttachments.attachedToType, request.attachedToType),
					eq(roleAttachments.attachedToId, request.attachedToId)
				),
				with: {
					role: true,
				},
			})
			if (foundRoles.length === 0) {
				return []
			}
			return foundRoles.map((r) => r.role as Role)
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
