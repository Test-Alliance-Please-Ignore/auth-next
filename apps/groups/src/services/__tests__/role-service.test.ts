import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER, ROLE_CORE_CORP_MEMBER } from '@repo/core'
import { ResourceType } from '@repo/groups'

import { RoleService } from '../role-service'

import type { ServiceContext } from '../context'

describe('RoleService.replaceCoreMembershipRolesForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('rejects unsupported role names before touching the database', async () => {
		const db = {
			query: {
				roles: {
					findMany: vi.fn(),
				},
			},
		}
		const service = new RoleService({
			db,
		} as unknown as ServiceContext)

		await expect(
			service.replaceCoreMembershipRolesForUser({
				userId: 'user-1',
				roles: [
					{
						roleName: 'urn:service:core:role:not-allowed',
						resourceId: '1000165',
						resourceType: ResourceType.CORPORATION,
					},
				],
			})
		).rejects.toThrow('Unsupported core membership role')
		expect(db.query.roles.findMany).not.toHaveBeenCalled()
	})

	it('deduplicates desired roles and returns diff counts', async () => {
		const createdAt = new Date('2026-03-19T00:00:00.000Z')
		const updatedAt = new Date('2026-03-19T00:00:00.000Z')

		const roleRows = [
			{
				id: 'role-corp',
				name: ROLE_CORE_CORP_MEMBER,
				ownedBy: 'urn:service:core',
				description: null,
				createdAt,
				updatedAt,
			},
			{
				id: 'role-alli',
				name: ROLE_CORE_ALLIANCE_MEMBER,
				ownedBy: 'urn:service:core',
				description: null,
				createdAt,
				updatedAt,
			},
		]

		const existingAttachments = [
			{
				id: 'att-corp',
				roleId: 'role-corp',
				attachedToType: 'user',
				attachedToId: 'user-1',
				resourceId: '1000165',
				resourceType: 'corporation',
				resourceMeta: null,
				createdAt,
				updatedAt,
				role: roleRows[0],
			},
			{
				id: 'att-stale-alli',
				roleId: 'role-alli',
				attachedToType: 'user',
				attachedToId: 'user-1',
				resourceId: '999',
				resourceType: 'alliance',
				resourceMeta: null,
				createdAt,
				updatedAt,
				role: roleRows[1],
			},
		]

		const finalAttachments = [
			existingAttachments[0],
			{
				id: 'att-new-alli',
				roleId: 'role-alli',
				attachedToType: 'user',
				attachedToId: 'user-1',
				resourceId: '498125261',
				resourceType: 'alliance',
				resourceMeta: null,
				createdAt,
				updatedAt,
				role: roleRows[1],
			},
		]

		const db = {
			query: {
				roles: {
					findMany: vi.fn().mockResolvedValue(roleRows),
				},
				roleAttachments: {
					findMany: vi
						.fn()
						.mockResolvedValueOnce(existingAttachments)
						.mockResolvedValueOnce(finalAttachments),
				},
			},
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({
					onConflictDoNothing: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{ id: 'att-new-alli' }]),
					}),
				}),
			}),
			delete: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue({ rowCount: 1 }),
			}),
		}
		const service = new RoleService({
			db,
		} as unknown as ServiceContext)

		const result = await service.replaceCoreMembershipRolesForUser({
			userId: 'user-1',
			roles: [
				{
					roleName: ROLE_CORE_CORP_MEMBER,
					resourceId: '1000165',
					resourceType: ResourceType.CORPORATION,
				},
				{
					roleName: ROLE_CORE_CORP_MEMBER,
					resourceId: '1000165',
					resourceType: ResourceType.CORPORATION,
				},
				{
					roleName: ROLE_CORE_ALLIANCE_MEMBER,
					resourceId: '498125261',
					resourceType: ResourceType.ALLIANCE,
				},
			],
		})

		expect(db.insert).toHaveBeenCalledTimes(1)
		expect(db.delete).toHaveBeenCalledTimes(1)
		expect(result.desiredCount).toBe(2)
		expect(result.attachedCount).toBe(1)
		expect(result.detachedCount).toBe(1)
		expect(result.roleAttachments).toHaveLength(2)
	})

	it('rolls back inserted rows if stale-detach phase fails', async () => {
		const createdAt = new Date('2026-03-19T00:00:00.000Z')
		const updatedAt = new Date('2026-03-19T00:00:00.000Z')

		const roleRows = [
			{
				id: 'role-corp',
				name: ROLE_CORE_CORP_MEMBER,
				ownedBy: 'urn:service:core',
				description: null,
				createdAt,
				updatedAt,
			},
			{
				id: 'role-alli',
				name: ROLE_CORE_ALLIANCE_MEMBER,
				ownedBy: 'urn:service:core',
				description: null,
				createdAt,
				updatedAt,
			},
		]

		const existingAttachments = [
			{
				id: 'att-corp',
				roleId: 'role-corp',
				attachedToType: 'user',
				attachedToId: 'user-1',
				resourceId: '1000165',
				resourceType: 'corporation',
				resourceMeta: null,
				createdAt,
				updatedAt,
				role: roleRows[0],
			},
			{
				id: 'att-stale-alli',
				roleId: 'role-alli',
				attachedToType: 'user',
				attachedToId: 'user-1',
				resourceId: '999',
				resourceType: 'alliance',
				resourceMeta: null,
				createdAt,
				updatedAt,
				role: roleRows[1],
			},
		]

		const deleteWhere = vi
			.fn()
			.mockRejectedValueOnce(new Error('delete failed'))
			.mockResolvedValueOnce({ rowCount: 1 })

		const db = {
			query: {
				roles: {
					findMany: vi.fn().mockResolvedValue(roleRows),
				},
				roleAttachments: {
					findMany: vi.fn().mockResolvedValue(existingAttachments),
				},
			},
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({
					onConflictDoNothing: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{ id: 'att-new-alli' }]),
					}),
				}),
			}),
			delete: vi.fn().mockReturnValue({
				where: deleteWhere,
			}),
		}
		const service = new RoleService({
			db,
		} as unknown as ServiceContext)

		await expect(
			service.replaceCoreMembershipRolesForUser({
				userId: 'user-1',
				roles: [
					{
						roleName: ROLE_CORE_CORP_MEMBER,
						resourceId: '1000165',
						resourceType: ResourceType.CORPORATION,
					},
					{
						roleName: ROLE_CORE_ALLIANCE_MEMBER,
						resourceId: '498125261',
						resourceType: ResourceType.ALLIANCE,
					},
				],
			})
		).rejects.toThrow('delete failed')

		expect(db.delete).toHaveBeenCalledTimes(2)
	})
})
