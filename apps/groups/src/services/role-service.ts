import { ROLE_CORE_ALLIANCE_MEMBER, ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { and, eq, inArray, isNull, sql } from '@repo/db-utils'
import { RoleAttachmentType } from '@repo/groups'
import { logger } from '@repo/hono-helpers'

import { roleAttachments, roles } from '../db/schema'

import type {
	AttachRoleToRequest,
	BatchAttachRoleToRequest,
	BatchCreateRolesRequest,
	BatchGetRolesForRequest,
	CreateRoleRequest,
	DetachRoleFromRequest,
	GetRolesForRequest,
	ReplaceCoreMembershipRolesForUserRequest,
	ReplaceCoreMembershipRolesForUserResponse,
	ResourceType,
	Role,
	RoleAttachment,
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
			const insertedRoles = await this.ctx.db
				.insert(roles)
				.values(request.roles)
				.onConflictDoUpdate({
					target: [roles.ownedBy, roles.name],
					set: {
						description: sql`excluded.description`,
						updatedAt: sql`CURRENT_TIMESTAMP`,
					},
				})
				.returning()
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
		if (request.roleId && request.roleName) {
			throw new Error('Cannot specify both roleId and roleName')
		}

		let role: Role | null = null
		if (request.roleId) {
			role = await this.getRole(request.roleId)
		}
		if (request.roleName) {
			role = await this.getRoleByName(request.roleName)
		}
		if (!role) {
			throw new Error(`Role not found: ${request.roleId || request.roleName}`)
		}

		try {
			// Try to insert with conflict handling (idempotent)
			const inserted = await this.ctx.db
				.insert(roleAttachments)
				.values({
					roleId: role.id,
					attachedToType: request.attachedToType,
					attachedToId: request.attachedToId,
					resourceId: request.resourceId,
					resourceType: request.resourceType as ResourceType,
				})
				.onConflictDoNothing()
				.returning()

			// If conflict occurred (role already attached), fetch the existing attachment
			if (inserted.length === 0) {
				const existing = await this.ctx.db.query.roleAttachments.findFirst({
					where: and(
						eq(roleAttachments.roleId, role.id),
						eq(roleAttachments.attachedToType, request.attachedToType),
						eq(roleAttachments.attachedToId, request.attachedToId),
						request.resourceId
							? eq(roleAttachments.resourceId, request.resourceId)
							: isNull(roleAttachments.resourceId),
						request.resourceType
							? eq(roleAttachments.resourceType, request.resourceType)
							: isNull(roleAttachments.resourceType)
					),
					with: {
						role: true,
					},
				})

				if (!existing) {
					throw new Error(
						'Failed to attach role: conflict occurred but existing attachment not found'
					)
				}

				return {
					id: existing.id,
					role: existing.role as Role,
					attachedToType: existing.attachedToType as RoleAttachmentType,
					attachedToId: existing.attachedToId,
					resourceId: existing.resourceId as string | undefined,
					resourceType: existing.resourceType as ResourceType | undefined,
					createdAt: existing.createdAt,
					updatedAt: existing.updatedAt,
				} as RoleAttachment
			}

			// Return the newly inserted attachment
			return {
				id: inserted[0].id,
				role: role as Role,
				attachedToType: inserted[0].attachedToType as RoleAttachmentType,
				attachedToId: inserted[0].attachedToId,
				resourceId: inserted[0].resourceId as string | undefined,
				resourceType: inserted[0].resourceType as ResourceType | undefined,
				createdAt: inserted[0].createdAt,
				updatedAt: inserted[0].updatedAt,
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

	async batchAttachRolesTo(request: BatchAttachRoleToRequest): Promise<RoleAttachment[]> {
		try {
			// Validate each request has roleId XOR roleName
			for (const req of request.roles) {
				if (req.roleId && req.roleName) {
					throw new Error('Cannot specify both roleId and roleName')
				}
				if (!req.roleId && !req.roleName) {
					throw new Error('Must specify either roleId or roleName')
				}
			}

			// Collect unique role IDs and names
			const roleIds = new Set<string>()
			const roleNames = new Set<string>()
			for (const req of request.roles) {
				if (req.roleId) roleIds.add(req.roleId)
				if (req.roleName) roleNames.add(req.roleName)
			}

			// Fetch all roles in parallel
			const [rolesById, rolesByName] = await Promise.all([
				roleIds.size > 0
					? this.ctx.db.query.roles.findMany({
							where: inArray(roles.id, Array.from(roleIds)),
						})
					: [],
				roleNames.size > 0
					? this.ctx.db.query.roles.findMany({
							where: inArray(roles.name, Array.from(roleNames)),
						})
					: [],
			])

			// Build role lookup map (by ID and by name)
			const roleMap = new Map<string, Role>()
			for (const role of rolesById) {
				roleMap.set(`id:${role.id}`, role as Role)
			}
			for (const role of rolesByName) {
				roleMap.set(`name:${role.name}`, role as Role)
			}

			// Validate all roles exist
			for (const req of request.roles) {
				const key = req.roleId ? `id:${req.roleId}` : `name:${req.roleName}`
				if (!roleMap.has(key)) {
					throw new Error(`Role not found: ${req.roleId || req.roleName}`)
				}
			}

			// Build values array with deduplication
			const valuesMap = new Map<
				string,
				{
					roleId: string
					attachedToType: RoleAttachmentType
					attachedToId: string
					resourceId?: string
					resourceType?: ResourceType
				}
			>()
			for (const req of request.roles) {
				const key = req.roleId ? `id:${req.roleId}` : `name:${req.roleName}`
				const role = roleMap.get(key)!

				// Create deduplication key based on unique constraint fields
				const dedupKey = `${role.id}|${req.attachedToType}|${req.attachedToId}|${req.resourceId || ''}|${req.resourceType || ''}`

				if (!valuesMap.has(dedupKey)) {
					valuesMap.set(dedupKey, {
						roleId: role.id,
						attachedToType: req.attachedToType as RoleAttachmentType,
						attachedToId: req.attachedToId,
						resourceId: req.resourceId,
						resourceType: req.resourceType as ResourceType,
					})
				}
			}

			const values = Array.from(valuesMap.values())

			// Return empty array if nothing to insert (all duplicates)
			if (values.length === 0) {
				return []
			}

			// Batch insert with conflict handling
			const inserted = await this.ctx.db
				.insert(roleAttachments)
				.values(values)
				.onConflictDoNothing()
				.returning()

			// Enrich with role objects and return
			return inserted.map((attachment) => ({
				id: attachment.id,
				role: roleMap.get(`id:${attachment.roleId}`)!,
				attachedToType: attachment.attachedToType as RoleAttachmentType,
				attachedToId: attachment.attachedToId,
				resourceId: attachment.resourceId as string | undefined,
				resourceType: attachment.resourceType as ResourceType | undefined,
				createdAt: attachment.createdAt,
				updatedAt: attachment.updatedAt,
			}))
		} catch (error) {
			console.error('[RoleService.batchAttachRolesTo] Failed to batch attach roles', {
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

	async replaceCoreMembershipRolesForUser(
		request: ReplaceCoreMembershipRolesForUserRequest
	): Promise<ReplaceCoreMembershipRolesForUserResponse> {
		const allowedRoleNames = new Set([ROLE_CORE_CORP_MEMBER, ROLE_CORE_ALLIANCE_MEMBER])

		const dedupedDesiredRoles = new Map<
			string,
			{
				roleName: string
				resourceId: string
				resourceType: ResourceType.CORPORATION | ResourceType.ALLIANCE
			}
		>()
		for (const role of request.roles) {
			if (!allowedRoleNames.has(role.roleName)) {
				throw new Error(`Unsupported core membership role: ${role.roleName}`)
			}
			const dedupKey = `${role.roleName}|${role.resourceId}|${role.resourceType}`
			dedupedDesiredRoles.set(dedupKey, role)
		}

		try {
			return await this.ctx.db.transaction(async (tx) => {
				const coreRoles = await tx.query.roles.findMany({
					where: inArray(roles.name, [ROLE_CORE_CORP_MEMBER, ROLE_CORE_ALLIANCE_MEMBER]),
				})
				const roleByName = new Map(coreRoles.map((role) => [role.name, role as Role]))

				if (!roleByName.has(ROLE_CORE_CORP_MEMBER) || !roleByName.has(ROLE_CORE_ALLIANCE_MEMBER)) {
					throw new Error('Core membership roles are missing. Seed roles before reconciliation.')
				}

				const coreRoleIds = [
					roleByName.get(ROLE_CORE_CORP_MEMBER)!.id,
					roleByName.get(ROLE_CORE_ALLIANCE_MEMBER)!.id,
				]

				const desiredRows = Array.from(dedupedDesiredRoles.values()).map((role) => ({
					roleId: roleByName.get(role.roleName)!.id,
					attachedToType: RoleAttachmentType.USER,
					attachedToId: request.userId,
					resourceId: role.resourceId,
					resourceType: role.resourceType,
				}))

				const existingCoreAttachments = await tx.query.roleAttachments.findMany({
					where: and(
						eq(roleAttachments.attachedToType, RoleAttachmentType.USER),
						eq(roleAttachments.attachedToId, request.userId),
						inArray(roleAttachments.roleId, coreRoleIds)
					),
					with: {
						role: true,
					},
				})

				const makeKey = (entry: {
					roleId: string
					resourceId?: string | null
					resourceType?: string | null
				}) => `${entry.roleId}|${entry.resourceId || ''}|${entry.resourceType || ''}`

				const existingKeys = new Set(
					existingCoreAttachments.map((attachment) => makeKey(attachment))
				)
				const rowsToInsert = desiredRows.filter((row) => !existingKeys.has(makeKey(row)))

				let insertedCount = 0
				if (rowsToInsert.length > 0) {
					const inserted = await tx
						.insert(roleAttachments)
						.values(rowsToInsert)
						.onConflictDoNothing()
						.returning({ id: roleAttachments.id })
					insertedCount = inserted.length
				}

				const desiredKeys = new Set(desiredRows.map((row) => makeKey(row)))
				const attachmentIdsToDelete = existingCoreAttachments
					.filter((attachment) => !desiredKeys.has(makeKey(attachment)))
					.map((attachment) => attachment.id)

				if (attachmentIdsToDelete.length > 0) {
					await tx.delete(roleAttachments).where(inArray(roleAttachments.id, attachmentIdsToDelete))
				}

				const finalCoreAttachments = await tx.query.roleAttachments.findMany({
					where: and(
						eq(roleAttachments.attachedToType, RoleAttachmentType.USER),
						eq(roleAttachments.attachedToId, request.userId),
						inArray(roleAttachments.roleId, coreRoleIds)
					),
					with: {
						role: true,
					},
				})

				return {
					roleAttachments: finalCoreAttachments.map((attachment) => ({
						id: attachment.id,
						role: attachment.role as Role,
						attachedToType: attachment.attachedToType as RoleAttachmentType,
						attachedToId: attachment.attachedToId,
						resourceId: attachment.resourceId as string | undefined,
						resourceType: attachment.resourceType as ResourceType | undefined,
						createdAt: attachment.createdAt,
						updatedAt: attachment.updatedAt,
					})),
					desiredCount: desiredRows.length,
					attachedCount: insertedCount,
					detachedCount: attachmentIdsToDelete.length,
				}
			})
		} catch (error) {
			console.error(
				'[RoleService.replaceCoreMembershipRolesForUser] Failed to reconcile core membership roles',
				{
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					request,
				}
			)
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
		if (request.roleIds && request.roleIds.length > 0) {
			const resolvedRoleIds: string[] = []
			const unresolvedNames: string[] = []

			// Separate UUIDs from role names (URNs)
			const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			for (const id of request.roleIds) {
				if (uuidRegex.test(id)) {
					resolvedRoleIds.push(id) // It's a UUID
				} else {
					unresolvedNames.push(id) // It's a role name (URN)
				}
			}

			// Resolve role names to IDs
			if (unresolvedNames.length > 0) {
				const resolvedRoles = await this.ctx.db.query.roles.findMany({
					where: inArray(roles.name, unresolvedNames),
				})

				// Validate all names were found
				const foundNames = new Set(resolvedRoles.map((r) => r.name))
				const missingNames = unresolvedNames.filter((name) => !foundNames.has(name))
				if (missingNames.length > 0) {
					throw new Error(`Roles not found: ${missingNames.join(', ')}`)
				}

				resolvedRoleIds.push(...resolvedRoles.map((r) => r.id))
			}

			// Add condition with all resolved IDs
			if (resolvedRoleIds.length > 0) {
				conditions.push(inArray(roleAttachments.roleId, resolvedRoleIds))
			}
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
