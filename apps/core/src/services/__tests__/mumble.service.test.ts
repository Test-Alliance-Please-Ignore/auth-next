import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import {
	deriveLoginName,
	provisionTempopGuest,
	syncUsersMumbleGroups,
	syncUsersMumbleProfiles,
} from '../mumble.service'

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
					is_admin: false,
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
							allianceId: 'alliance-1',
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
			getRolesFor: vi.fn().mockResolvedValue([]),
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

	it('adds Server Admin for site admins alongside affiliation groups', async () => {
		createDbMock.mockReturnValue({
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({
						mainCharacterId: MAIN_CHARACTER_ID,
						is_admin: true,
					}),
				},
				userCharacters: {
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

		const hrStub = {
			isUserBlacklisted: vi.fn().mockResolvedValue(false),
		}
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([
				{ groupName: 'Fleet', mumbleSyncEnabled: true },
			]),
			getRolesFor: vi.fn().mockResolvedValue([]),
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

		expect(mumbleStub.syncUserGroups).toHaveBeenCalledWith(
			'srv',
			[{ subjectId: 'user-1', groups: ['Fleet', 'Server Admin'] }],
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
			getRolesFor: vi.fn().mockResolvedValue([]),
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
				return [{ groupName: `group-${userId}`, mumbleSyncEnabled: true }]
			}),
			getRolesFor: vi.fn().mockResolvedValue([]),
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
				return [{ groupName: `group-${userId}`, mumbleSyncEnabled: true }]
			}),
			getRolesFor: vi.fn().mockResolvedValue([]),
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

	it('ignores groups that are not opted in for mumble sync', async () => {
		setEligibleDbMock()

		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([
				{ groupName: 'Fleet', mumbleSyncEnabled: true },
				{ groupName: 'Ops', mumbleSyncEnabled: false },
			]),
			getRolesFor: vi.fn().mockResolvedValue([]),
		}
		const hrStub = {
			isUserBlacklisted: vi.fn().mockResolvedValue(false),
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

		expect(mumbleStub.syncUserGroups).toHaveBeenCalledWith(
			'srv',
			[{ subjectId: 'user-1', groups: ['Fleet'] }],
			undefined
		)
	})
})

describe('syncUsersMumbleProfiles', () => {
	const env = {
		DATABASE_URL: 'postgres://example',
		FEATURES: {},
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
						is_admin: false,
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
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([
				{ groupName: 'Fleet', mumbleSyncEnabled: true, mumbleTicker: 'fc-123!' },
			]),
			getRolesFor: vi.fn().mockResolvedValue([]),
		}

		const mumbleStub = {
			syncAccountProfiles: vi.fn().mockResolvedValue({ synced: ['user-1'], skipped: [] }),
		}
		const featuresStub = {
			checkFlag: vi.fn().mockResolvedValue(true),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.FEATURES) return featuresStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		const result = await syncUsersMumbleProfiles(env, ['user-1'])

		expect(corpStub.getCorporationInfo).toHaveBeenCalledWith('corp-1')
		expect(mumbleStub.syncAccountProfiles).toHaveBeenCalledWith('srv', [
			{ subjectId: 'user-1', displayName: 'Main Pilot [ALP] [FC123]' },
		])
		expect(result).toEqual({ synced: ['user-1'], skipped: [] })
	})

	it('appends SA to admin display metadata after the ticker', async () => {
		createDbMock.mockReturnValue({
			query: {
				users: {
					findFirst: vi.fn().mockResolvedValue({
						mainCharacterId: MAIN_CHARACTER_ID,
						is_admin: true,
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
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([
				{ groupName: 'Fleet', mumbleSyncEnabled: true, mumbleTicker: 'fc-123!' },
			]),
			getRolesFor: vi.fn().mockResolvedValue([]),
		}

		const mumbleStub = {
			syncAccountProfiles: vi.fn().mockResolvedValue({ synced: ['user-1'], skipped: [] }),
		}
		const featuresStub = {
			checkFlag: vi.fn().mockResolvedValue(true),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.FEATURES) return featuresStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.GROUPS) return groupsStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		await syncUsersMumbleProfiles(env, ['user-1'])

		expect(mumbleStub.syncAccountProfiles).toHaveBeenCalledWith('srv', [
			{ subjectId: 'user-1', displayName: 'Main Pilot [ALP] [FC123] [SA]' },
		])
	})

	it('skips profile sync when the mumble feature is disabled', async () => {
		createDbMock.mockReturnValue({
			query: {
				users: {
					findFirst: vi.fn(),
				},
				userCharacters: {
					findFirst: vi.fn(),
				},
			},
		} as any)

		const featuresStub = {
			checkFlag: vi.fn().mockResolvedValue(false),
		}
		const mumbleStub = {
			syncAccountProfiles: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.FEATURES) return featuresStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		const result = await syncUsersMumbleProfiles(env, ['user-1'])

		expect(featuresStub.checkFlag).toHaveBeenCalledWith('mumble.enabled')
		expect(mumbleStub.syncAccountProfiles).not.toHaveBeenCalled()
		expect(result).toEqual({ synced: [], skipped: ['user-1'] })
	})
})

describe('provisionTempopGuest', () => {
	const env = {
		DATABASE_URL: 'postgres://example',
		EVE_CHARACTER_DATA: {},
		EVE_CORPORATION_DATA: {},
		EVE_TOKEN_STORE: {},
		MUMBLE: {},
		MUMBLE_SERVER_ID: 'srv',
		MUMBLE_HOST: 'voice.test',
		MUMBLE_PORT: '64738',
	} as any

	it('prefers alliance ticker over corp ticker for the temp-op guest display name', async () => {
		const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined)
		const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }))
		const insertMock = vi.fn(() => ({
			values: valuesMock,
		}))
		createDbMock.mockReturnValue({
			query: {
				mumbleTempops: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'tempop-1',
						shortCode: 'TP1',
						groupName: 'TempOp',
						status: 'active',
						expiresAt: new Date('2099-06-26T14:00:00.000Z'),
					}),
				},
				mumbleTempopGuests: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
			},
			insert: insertMock,
		} as any)

		const characterStub = {
			refreshPublicCharacterData: vi.fn().mockResolvedValue({
				characterName: 'Temp Pilot',
				currentCorporationId: 'corp-1',
				currentAllianceId: 'ally-1',
			}),
		}
		const corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({
				ticker: 'Corp',
			}),
		}
		const tokenStoreStub = {
			getAllianceById: vi.fn().mockResolvedValue({
				ticker: 'Alliance',
			}),
		}
		const mumbleStub = {
			provisionAccount: vi.fn().mockResolvedValue({
				account: { loginName: 'Temp_Pilot' },
				password: 'one-time-password',
			}),
			resetPassword: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) return characterStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE) return tokenStoreStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		const result = await provisionTempopGuest(env, {
			tempopId: 'tempop-1',
			characterId: 'char-1',
		})

		expect(characterStub.refreshPublicCharacterData).toHaveBeenCalledWith('char-1', false)
		expect(corpStub.getCorporationInfo).toHaveBeenCalledWith('corp-1')
		expect(tokenStoreStub.getAllianceById).toHaveBeenCalledWith('ally-1')
		expect(mumbleStub.provisionAccount).toHaveBeenCalledWith('srv', {
			subjectId: 'tempop:tempop-1:char-1',
			loginName: 'Temp_Pilot',
			displayName: '[T] Temp Pilot [ALLIA] [TP1]',
			groups: ['TempOp'],
			comment: 'tempop tempop-1',
		})
		expect(valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				tempopId: 'tempop-1',
				characterId: 'char-1',
				characterName: 'Temp Pilot',
				corporationId: 'corp-1',
				allianceId: 'ally-1',
				corpTicker: 'CORP',
				subjectId: 'tempop:tempop-1:char-1',
				loginName: 'Temp_Pilot',
				status: 'active',
			})
		)
		expect(result).toEqual({
			loginName: 'Temp_Pilot',
			password: 'one-time-password',
			connection: { host: 'voice.test', port: 64738 },
		})
	})

	it('falls back to the corp ticker when there is no alliance affiliation', async () => {
		const onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined)
		const valuesMock = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateMock }))
		const insertMock = vi.fn(() => ({
			values: valuesMock,
		}))
		createDbMock.mockReturnValue({
			query: {
				mumbleTempops: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'tempop-1',
						shortCode: 'TP1',
						groupName: 'TempOp',
						status: 'active',
						expiresAt: new Date('2099-06-26T14:00:00.000Z'),
					}),
				},
				mumbleTempopGuests: {
					findFirst: vi.fn().mockResolvedValue(null),
				},
			},
			insert: insertMock,
		} as any)

		const characterStub = {
			refreshPublicCharacterData: vi.fn().mockResolvedValue({
				characterName: 'Temp Pilot',
				currentCorporationId: 'corp-1',
				currentAllianceId: null,
			}),
		}
		const corpStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({
				ticker: 'Corp',
			}),
		}
		const tokenStoreStub = {
			getAllianceById: vi.fn(),
		}
		const mumbleStub = {
			provisionAccount: vi.fn().mockResolvedValue({
				account: { loginName: 'Temp_Pilot' },
				password: 'one-time-password',
			}),
			resetPassword: vi.fn(),
		}

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) return characterStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corpStub as any
			if (binding === env.EVE_TOKEN_STORE) return tokenStoreStub as any
			if (binding === env.MUMBLE) return mumbleStub as any
			throw new Error('unexpected stub binding')
		})

		const result = await provisionTempopGuest(env, {
			tempopId: 'tempop-1',
			characterId: 'char-1',
		})

		expect(characterStub.refreshPublicCharacterData).toHaveBeenCalledWith('char-1', false)
		expect(corpStub.getCorporationInfo).toHaveBeenCalledWith('corp-1')
		expect(tokenStoreStub.getAllianceById).not.toHaveBeenCalled()
		expect(mumbleStub.provisionAccount).toHaveBeenCalledWith('srv', {
			subjectId: 'tempop:tempop-1:char-1',
			loginName: 'Temp_Pilot',
			displayName: '[T] Temp Pilot [CORP] [TP1]',
			groups: ['TempOp'],
			comment: 'tempop tempop-1',
		})
		expect(valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				tempopId: 'tempop-1',
				characterId: 'char-1',
				characterName: 'Temp Pilot',
				corporationId: 'corp-1',
				allianceId: null,
				corpTicker: 'CORP',
				subjectId: 'tempop:tempop-1:char-1',
				loginName: 'Temp_Pilot',
				status: 'active',
			})
		)
		expect(result).toEqual({
			loginName: 'Temp_Pilot',
			password: 'one-time-password',
			connection: { host: 'voice.test', port: 64738 },
		})
	})
})
