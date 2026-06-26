import { describe, expect, it, vi, beforeEach } from 'vitest'

import { HrRoleService } from '../../services/hr-role.service'

import type { ServiceContext } from '../../services/context'

const { getStubMock } = vi.hoisted(() => ({
	getStubMock: vi.fn((binding: Record<string, unknown>, name: string) => {
		if (binding && typeof binding === 'object' && name in binding) {
			return binding[name]
		}
		return binding
	}),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: getStubMock,
}))

function makeService(options: {
	ceoCharacterId?: string
	directorCharacterIds?: string[]
}) {
	const corpId = 'corp-1'
	const userId = 'user-1'
	const characterId = options.ceoCharacterId ?? 'char-1'
	const directorCharacterIds = options.directorCharacterIds ?? []

	const groupsStub = {
		getRoleByName: vi.fn(async (name: string) => ({ id: `role:${name}` })),
		getRolesFor: vi.fn().mockResolvedValue([]),
	}

	const corporationStub = {
		getCorporationInfo: vi.fn(async () => ({ ceoId: characterId })),
		getDirectors: vi.fn(async () =>
			directorCharacterIds.map((directorCharacterId) => ({
				characterId: directorCharacterId,
			}))
		),
	}

	const db = {
		execute: vi.fn().mockResolvedValue({
			rows: [{ corporation_id: corpId, character_id: characterId }],
		}),
	} as unknown as ServiceContext['db']

	const service = new HrRoleService({
		db,
		env: {
			GROUPS: { default: groupsStub },
			EVE_CORPORATION_DATA: { [corpId]: corporationStub },
		},
	} as unknown as ServiceContext)

	return { service, corpId, userId, characterId, groupsStub, corporationStub, db }
}

describe('HrRoleService.getUserHrCorporations', () => {
	beforeEach(() => {
		getStubMock.mockClear()
	})

	it('includes corporations where the user is the CEO', async () => {
		const { service, corpId } = makeService({ ceoCharacterId: 'char-1' })

		await expect(service.getUserHrCorporations('user-1')).resolves.toEqual([corpId])
	})

	it('includes corporations where the user is a director', async () => {
		const { service, corpId } = makeService({
			ceoCharacterId: 'someone-else',
			directorCharacterIds: ['char-1'],
		})

		await expect(service.getUserHrCorporations('user-1')).resolves.toEqual([corpId])
	})
})
