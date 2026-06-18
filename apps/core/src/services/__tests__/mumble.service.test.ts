import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { deriveLoginName, syncUsersMumbleGroups, syncUsersMumbleProfiles } from '../mumble.service'

// @neondatabase/api-client (pulled in via @repo/db-utils test helpers) breaks
// the workers-pool CJS shim; it is irrelevant to these tests.
vi.mock('@neondatabase/api-client', () => ({
	createApiClient: vi.fn(),
	EndpointType: {},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

const USER_ID = '123e4567-e89b-12d3-a456-426614174000'
const MAIN_CHARACTER_ID = '9001'

function setEligibleDbMock() {
	createDbMock.mockReturnValue({
		query: {
			users: {
				findFirst: vi.fn().mockResolvedValue({
					mainCharacterId: MAIN_CHARACTER_ID,
				}),
			},
			userCharacters: {
				findFirst: vi.fn().mockResolvedValue({
					characterName: 'Main Pilot',
					corporationId: 'corp-1',
				}),
				findMany: vi.fn().mockResolvedValue([
					{
						corporationId: 'corp-1',
						allianceId: null,
					},
				]),
			},
			managedCorporations: {
				findMany: vi.fn().mockResolvedValue([
					{
						corporationId: 'corp-1',
					},
				]),
			},
		},
	} as any)
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('deriveLoginName', () => {
	it('replaces spaces with underscores', () => {
		expect(deriveLoginName('Pilot One', USER_ID)).toBe('Pilot_One')
	})

	it('keeps allowed characters and strips the rest', () => {
		expect(deriveLoginName("Kael'Thar D-Ray.99", USER_ID)).toBe('KaelThar_D-Ray.99')
	})

	it('collapses repeated underscores', () => {
		expect(deriveLoginName('A   B', USER_ID)).toBe('A_B')
	})

	it('trims leading/trailing separators left by stripping', () => {
		expect(deriveLoginName("'Quote' Name", USER_ID)).toBe('Quote_Name')
	})

	it('caps the length at 60 characters', () => {
		const long = 'x'.repeat(100)
		expect(deriveLoginName(long, USER_ID)).toHaveLength(60)
	})

	it('falls back to a userId-derived name when nothing usable remains', () => {
		expect(deriveLoginName('日本語の名前', USER_ID)).toBe('user_123e4567')
		expect(deriveLoginName('', USER_ID)).toBe('user_123e4567')
		expect(deriveLoginName("'''", USER_ID)).toBe('user_123e4567')
	})
})

describe('syncUsersMumbleGroups', () => {
	const env = {
		DATABASE_URL: 'postgres://example',
		HR: {},
		GROUPS: {},
		MUMBLE: {},
		MUMBLE_SERVER_ID: 'srv',
	} as any

	it('short-circuits to empty groups when the user lacks qualifying affiliation', async () => {
		createDbMock.mockReturnValue({
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({ mainCharacterId: MAIN_CHARACTER_ID }),
				},
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{
							corporationId: 'corp-2',
							allianceId: null,
						},
					]),
				},
				managedCorporations: {
					findMany: vi.fn().mockResolvedValue([
						{
							corporationId: 'corp-1',
						},
					]),
				},
			},
		} as any)

		const hrStub = {
			isUserBlacklisted: vi.fn().mockResolvedValue(false),
		}
		const groupsStub = {
			getUserMemberships: vi.fn(),
		}

		const mumbleStub = {
			syncUserGroups: vi.fn().mockResolvedValue({ synced: ['user-1'], skipped: [] }),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		await syncUsersMumbleGroups(env, ['user-1'])

		expect(groupsStub.getUserMemberships).not.toHaveBeenCalled()
		expect(mumbleStub.syncUserGroups).toHaveBeenCalledWith(
			'srv',
			[{ subjectId: 'user-1', groups: [] }],
			undefined
		)
	})

	it('short-circuits to empty groups when the user is blacklisted', async () => {
		createDbMock.mockReturnValue({
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({ mainCharacterId: MAIN_CHARACTER_ID }),
				},
				userCharacters: {
					findMany: vi.fn(),
				},
				managedCorporations: {
					findMany: vi.fn(),
				},
			},
		} as any)

		const hrStub = {
			isUserBlacklisted: vi.fn().mockResolvedValue(true),
		}
		const groupsStub = {
			getUserMemberships: vi.fn(),
		}
		const mumbleStub = {
			syncUserGroups: vi.fn().mockResolvedValue({ synced: ['user-1'], skipped: [] }),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		await syncUsersMumbleGroups(env, ['user-1'])

		expect(hrStub.isUserBlacklisted).toHaveBeenCalledWith('user-1')
		expect(groupsStub.getUserMemberships).not.toHaveBeenCalled()
		expect(mumbleStub.syncUserGroups).toHaveBeenCalledWith(
			'srv',
			[{ subjectId: 'user-1', groups: [] }],
			undefined
		)
	})

	it('uses bounded concurrency when collecting memberships', async () => {
		setEligibleDbMock()

		let inFlight = 0
		let maxInFlight = 0

		const groupsStub = {
			getUserMemberships: vi.fn(async (userId: string) => {
				inFlight += 1
				maxInFlight = Math.max(maxInFlight, inFlight)
				await new Promise((resolve) => setTimeout(resolve, 5))
				inFlight -= 1
				return [{ groupName: `group-${userId}` }]
			}),
		}
		const hrStub = {
			isUserBlacklisted: vi.fn().mockResolvedValue(false),
		}

		const mumbleStub = {
			syncUserGroups: vi.fn().mockResolvedValue({ synced: [], skipped: [] }),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		const userIds = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6']
		await syncUsersMumbleGroups(env, userIds, 'group-changed')

		expect(maxInFlight).toBeLessThanOrEqual(5)
		expect(mumbleStub.syncUserGroups).toHaveBeenCalledWith(
			'srv',
			userIds.map((userId) => ({ subjectId: userId, groups: [`group-${userId}`] })),
			'group-changed'
		)
	})

	it('syncs successful users and still fails when any group lookup fails', async () => {
		setEligibleDbMock()

		const groupsStub = {
			getUserMemberships: vi.fn(async (userId: string) => {
				if (userId === 'user-2') {
					throw new Error('boom')
				}
				return [{ groupName: `group-${userId}` }]
			}),
		}
		const hrStub = {
			isUserBlacklisted: vi.fn().mockResolvedValue(false),
		}

		const mumbleStub = {
			syncUserGroups: vi.fn().mockResolvedValue({ synced: ['user-1', 'user-3'], skipped: [] }),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) return hrStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		await expect(syncUsersMumbleGroups(env, ['user-1', 'user-2', 'user-3'])).rejects.toThrow(
			'Failed to gather groups for 1 user(s): user-2'
		)
		expect(mumbleStub.syncUserGroups).toHaveBeenCalledTimes(1)
		expect(mumbleStub.syncUserGroups).toHaveBeenCalledWith(
			'srv',
			[
				{ subjectId: 'user-1', groups: ['group-user-1'] },
				{ subjectId: 'user-3', groups: ['group-user-3'] },
			],
			undefined
		)
	})
})

describe('syncUsersMumbleProfiles', () => {
	const env = {
		DATABASE_URL: 'postgres://example',
		EVE_CORPORATION_DATA: {},
		MUMBLE: {},
		MUMBLE_SERVER_ID: 'srv',
	} as any

	it('updates display metadata with the corporation ticker', async () => {
		createDbMock.mockReturnValue({
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({
						mainCharacterId: MAIN_CHARACTER_ID,
					}),
				},
				userCharacters: {
					findFirst: vi.fn().mockResolvedValue({
						characterName: 'Main Pilot',
						corporationId: 'corp-1',
					}),
				},
			},
		} as any)

		const corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({
				corporationId: 'corp-1',
				name: 'Alpha',
				ticker: 'ALP',
			}),
		}

		const mumbleStub = {
			syncAccountProfiles: vi.fn().mockResolvedValue({ synced: ['user-1'], skipped: [] }),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		const result = await syncUsersMumbleProfiles(env, ['user-1'])

		expect(corpStub.getCorporationInfo).toHaveBeenCalledWith('corp-1')
		expect(mumbleStub.syncAccountProfiles).toHaveBeenCalledWith('srv', [
			{ subjectId: 'user-1', displayName: 'Main Pilot [ALP]' },
		])
		expect(result).toEqual({ synced: ['user-1'], skipped: [] })
	})
})
