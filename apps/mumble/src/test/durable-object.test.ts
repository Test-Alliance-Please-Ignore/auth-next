import { describe, expect, it, vi } from 'vitest'

import { parseMumbleError } from '@repo/mumble'

import { MumbleDO } from '../durable-object'

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {},
}))

vi.mock('@repo/hono-helpers', () => ({
	captureException: vi.fn(),
}))

const SNAPSHOT = {
	subjectId: 'user-1',
	loginName: 'pilot_one',
	displayName: 'Pilot One',
	enabled: true,
	groups: ['alpha'],
	status: 'reconciled',
	comment: null,
	hasPassword: true,
	lastCertificateHash: null,
	lastAuthenticatedAt: null,
	lastClientRelease: null,
	lastClientVersion: null,
}

interface FakeClient {
	getLocalAccount: ReturnType<typeof vi.fn>
	getUserState: ReturnType<typeof vi.fn>
	batchSync: ReturnType<typeof vi.fn>
	assignGroups: ReturnType<typeof vi.fn>
	enable: ReturnType<typeof vi.fn>
	disable: ReturnType<typeof vi.fn>
	delete: ReturnType<typeof vi.fn>
	deleteProjectedUser: ReturnType<typeof vi.fn>
}

function makeFakeClient(): FakeClient {
	return {
		getLocalAccount: vi.fn(),
		getUserState: vi.fn().mockResolvedValue({ serverId: 'srv', users: [] }),
		batchSync: vi.fn(),
		assignGroups: vi.fn(),
		enable: vi.fn(),
		disable: vi.fn(),
		delete: vi.fn(),
		deleteProjectedUser: vi.fn().mockResolvedValue(undefined),
	}
}

function makeFakeStorage() {
	const data = new Map<string, unknown>()
	let alarmAt: number | null = null
	return {
		data,
		get: vi.fn(async (key: string) => data.get(key)),
		put: vi.fn(async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
			if (typeof keyOrEntries === 'string') {
				data.set(keyOrEntries, value)
				return
			}
			for (const [key, entryValue] of Object.entries(keyOrEntries)) data.set(key, entryValue)
		}),
		delete: vi.fn(async (keys: string | string[]) => {
			for (const key of typeof keys === 'string' ? [keys] : keys) data.delete(key)
		}),
		list: vi.fn(async ({ prefix }: { prefix: string }) => {
			const result = new Map<string, unknown>()
			for (const [key, value] of data) {
				if (key.startsWith(prefix)) result.set(key, value)
			}
			return result
		}),
		getAlarm: vi.fn(async () => alarmAt),
		setAlarm: vi.fn(async (at: number) => {
			alarmAt = at
		}),
		deleteAlarm: vi.fn(async () => {
			alarmAt = null
		}),
	}
}

function makeFakeThis(client: FakeClient, overrides: Record<string, unknown> = {}) {
	const proto = MumbleDO.prototype as unknown as Record<string, unknown>
	return {
		env: {
			MUMBLE_CONTROL_SAFE_PROJECTION_DELETE: 'true',
			CORE: { decideMumbleDeleteRetry: vi.fn().mockResolvedValue('retry') },
		},
		bucketTokens: 10,
		bucketLastRefill: Date.now(),
		writeLock: Promise.resolve(),
		state: { storage: makeFakeStorage() },
		client: () => client,
		serialize: proto.serialize,
		takeToken: proto.takeToken,
		handleError: proto.handleError,
		resolveLoginName: proto.resolveLoginName,
		userSyncKey: proto.userSyncKey,
		scheduleUserSyncAlarm: proto.scheduleUserSyncAlarm,
		cleanupUserSyncStates: proto.cleanupUserSyncStates,
		findProvisionedSubjects: proto.findProvisionedSubjects,
		getProjectedUsers: proto.getProjectedUsers,
		deleteAccountsInner: proto.deleteAccountsInner,
		clearPendingDelete: proto.clearPendingDelete,
		queuePendingDeletes: proto.queuePendingDeletes,
		alarm: proto.alarm,
		...overrides,
	}
}

async function expectMumbleError(promise: Promise<unknown>, code: string) {
	const error = await promise.then(
		() => null,
		(e: unknown) => e
	)
	expect(error).toBeInstanceOf(Error)
	expect(parseMumbleError(error)?.code).toBe(code)
}

describe('MumbleDO.provisionAccount', () => {
	const input = {
		subjectId: 'user-1',
		loginName: 'Pilot One',
		displayName: 'Pilot One',
		groups: ['alpha'],
	}

	it('throws already_exists when the subject has an account', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)

		await expectMumbleError(
			MumbleDO.prototype.provisionAccount.call(makeFakeThis(client) as any, 'srv', input),
			'already_exists'
		)
		expect(client.batchSync).not.toHaveBeenCalled()
	})

	it('provisions with a lowercased login name and one-time password', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.getUserState.mockResolvedValue({ serverId: 'srv', users: [] })
		client.batchSync.mockResolvedValue({ serverId: 'srv', updated: [SNAPSHOT] })

		const result = await MumbleDO.prototype.provisionAccount.call(
			makeFakeThis(client) as any,
			'srv',
			input
		)

		expect(result.password).toMatch(/^[A-Za-z0-9]{24}$/)
		expect(result.account.subjectId).toBe('user-1')

		const synced = client.batchSync.mock.calls[0]![1][0]
		expect(synced.loginName).toBe('pilot one')
		expect(synced.enabled).toBe(true)
		expect(synced.groups).toEqual(['alpha'])
		expect(synced.passwordVerifier.algorithm).toBe('pbkdf2-sha256')
		expect(atob(synced.passwordVerifier.hash).length).toBe(32)
	})

	it('supersedes a queued deletion when a new account is provisioned', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.batchSync.mockResolvedValue({ serverId: 'srv', updated: [SNAPSHOT] })
		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', Date.now())

		await MumbleDO.prototype.provisionAccount.call(fakeThis as any, 'srv', input)

		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
	})

	it('resolves login name collisions with numeric suffixes', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.getUserState.mockImplementation(
			async (_serverId: string, filter: { loginName?: string }) => ({
				serverId: 'srv',
				users:
					filter.loginName === 'pilot one'
						? [{ ...SNAPSHOT, subjectId: 'someone-else', loginName: 'pilot one' }]
						: [],
			})
		)
		client.batchSync.mockResolvedValue({ serverId: 'srv', updated: [SNAPSHOT] })

		await MumbleDO.prototype.provisionAccount.call(makeFakeThis(client) as any, 'srv', input)

		expect(client.batchSync.mock.calls[0]![1][0].loginName).toBe('pilot one_2')
	})

	it('throws login_name_taken when all candidates are held by others', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.getUserState.mockResolvedValue({
			serverId: 'srv',
			users: [{ ...SNAPSHOT, subjectId: 'someone-else' }],
		})

		await expectMumbleError(
			MumbleDO.prototype.provisionAccount.call(makeFakeThis(client) as any, 'srv', input),
			'login_name_taken'
		)
	})

	it('throws busy when the token bucket is exhausted', async () => {
		const client = makeFakeClient()

		await expectMumbleError(
			MumbleDO.prototype.provisionAccount.call(
				makeFakeThis(client, { bucketTokens: 0, bucketLastRefill: Date.now() }) as any,
				'srv',
				input
			),
			'busy'
		)
		expect(client.getLocalAccount).not.toHaveBeenCalled()
	})
})

describe('MumbleDO user sync leases', () => {
	it('allows one claim and suppresses concurrent claims', async () => {
		const client = makeFakeClient()
		const state = makeFakeThis(client) as any

		const first = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			1_000
		)
		const second = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			1_001
		)

		expect(first).toEqual({ token: expect.any(String) })
		expect(second).toBeNull()
	})

	it('starts a new claim after completion and cooldown expiry', async () => {
		const client = makeFakeClient()
		const state = makeFakeThis(client) as any

		const first = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			1_000
		)
		await MumbleDO.prototype.completeUserSync.call(state, 'srv', 'user-1', first!.token, 1_001)

		const duringCooldown = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			299_999
		)
		const afterCooldown = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			301_001
		)

		expect(duringCooldown).toBeNull()
		expect(afterCooldown).toEqual({ token: expect.any(String) })
	})

	it('releases a failed claim so it can be retried immediately', async () => {
		const client = makeFakeClient()
		const state = makeFakeThis(client) as any

		const first = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			1_000
		)
		await MumbleDO.prototype.releaseUserSync.call(state, 'srv', 'user-1', first!.token)
		const retry = await MumbleDO.prototype.tryClaimUserSync.call(
			state,
			'srv',
			'user-1',
			300_000,
			60_000,
			1_001
		)

		expect(retry).toEqual({ token: expect.any(String) })
	})
})

describe('MumbleDO.resetPassword', () => {
	it('throws not_found for unprovisioned subjects', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)

		await expectMumbleError(
			MumbleDO.prototype.resetPassword.call(makeFakeThis(client) as any, 'srv', 'user-1'),
			'not_found'
		)
	})

	it('echoes the current account with fresh verifier material', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		client.batchSync.mockResolvedValue({ serverId: 'srv', updated: [SNAPSHOT] })

		const result = await MumbleDO.prototype.resetPassword.call(
			makeFakeThis(client) as any,
			'srv',
			'user-1'
		)

		expect(result.password).toMatch(/^[A-Za-z0-9]{24}$/)
		const synced = client.batchSync.mock.calls[0]![1][0]
		expect(synced.loginName).toBe('pilot_one')
		expect(synced.enabled).toBe(true)
		expect(synced.groups).toEqual(['alpha'])
		expect(synced.passwordVerifier.iterations).toBe(100_000)
	})
})

describe('MumbleDO.syncUserGroups', () => {
	it('filters unprovisioned subjects with per-subject reads for small batches', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockImplementation(async (_serverId: string, subjectId: string) =>
			subjectId === 'user-1' ? SNAPSHOT : null
		)
		client.assignGroups.mockResolvedValue({ serverId: 'srv', disconnectedSessions: 0, updated: [] })

		const result = await MumbleDO.prototype.syncUserGroups.call(
			makeFakeThis(client) as any,
			'srv',
			[
				{ subjectId: 'user-1', groups: ['alpha'] },
				{ subjectId: 'user-2', groups: ['beta'] },
			]
		)

		expect(result).toEqual({ synced: ['user-1'], skipped: ['user-2'] })
		expect(client.getUserState).not.toHaveBeenCalled()
		expect(client.assignGroups).toHaveBeenCalledTimes(1)
		expect(client.assignGroups.mock.calls[0]![1]).toEqual([
			{ subjectId: 'user-1', groups: ['alpha'] },
		])
	})

	it('uses a single user-state read for larger batches and chunks writes', async () => {
		const provisionedIds = Array.from({ length: 250 }, (_, i) => `user-${i}`)
		const client = makeFakeClient()
		client.getUserState.mockResolvedValue({
			serverId: 'srv',
			users: [
				...provisionedIds.map((subjectId) => ({ ...SNAPSHOT, subjectId, status: 'reconciled' })),
				{ ...SNAPSHOT, subjectId: 'queued-user', status: 'queued' },
			],
		})
		client.assignGroups.mockResolvedValue({ serverId: 'srv', disconnectedSessions: 0, updated: [] })

		const assignments = [
			...provisionedIds.map((subjectId) => ({ subjectId, groups: ['alpha'] })),
			{ subjectId: 'queued-user', groups: ['gamma'] },
			{ subjectId: 'unprovisioned', groups: ['beta'] },
		]
		const result = await MumbleDO.prototype.syncUserGroups.call(
			makeFakeThis(client) as any,
			'srv',
			assignments
		)

		expect(client.getLocalAccount).not.toHaveBeenCalled()
		expect(client.getUserState).toHaveBeenCalledTimes(1)
		// Queued projections still represent provisioned local accounts.
		expect(client.assignGroups).toHaveBeenCalledTimes(2)
		expect(client.assignGroups.mock.calls[0]![1]).toHaveLength(200)
		expect(client.assignGroups.mock.calls[1]![1]).toHaveLength(51)
		expect(result.synced).toHaveLength(251)
		expect(result.skipped).toEqual(['unprovisioned'])
	})

	it('returns immediately for empty input', async () => {
		const client = makeFakeClient()
		const result = await MumbleDO.prototype.syncUserGroups.call(
			makeFakeThis(client) as any,
			'srv',
			[]
		)
		expect(result).toEqual({ synced: [], skipped: [] })
		expect(client.assignGroups).not.toHaveBeenCalled()
	})
})

describe('MumbleDO.syncAccountProfiles', () => {
	it('updates a queued account after a group write without changing its other fields', async () => {
		const client = makeFakeClient()
		client.getUserState.mockResolvedValue({
			serverId: 'srv',
			users: [{ ...SNAPSHOT, status: 'queued', groups: ['new-group'] }],
		})
		client.batchSync.mockResolvedValue({ serverId: 'srv', updated: [] })

		const result = await MumbleDO.prototype.syncAccountProfiles.call(
			makeFakeThis(client) as any,
			'srv',
			[{ subjectId: 'user-1', displayName: 'Pilot One [NEW]' }]
		)

		expect(result).toEqual({ synced: ['user-1'], skipped: [] })
		expect(client.batchSync).toHaveBeenCalledWith('srv', [
			{
				subjectId: 'user-1',
				loginName: 'pilot_one',
				displayName: 'Pilot One [NEW]',
				enabled: true,
				groups: ['new-group'],
			},
		])
	})
})

describe('MumbleDO.deleteAccounts', () => {
	it('verifies deletion and reports subjects with neither local nor projected state as notFound', async () => {
		const client = makeFakeClient()
		let hasLocalAccount = true
		client.getLocalAccount.mockImplementation(async (_serverId: string, subjectId: string) =>
			subjectId === 'user-1' && hasLocalAccount ? SNAPSHOT : null
		)
		client.delete.mockImplementation(async () => {
			hasLocalAccount = false
			return { serverId: 'srv', deletedSubjectIds: ['user-1'], disconnectedSessions: 1 }
		})

		const result = await MumbleDO.prototype.deleteAccounts.call(
			makeFakeThis(client) as any,
			'srv',
			['user-1', 'user-2'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: ['user-1'], notFound: ['user-2'], queued: [] })
		expect(client.delete).toHaveBeenCalledTimes(1)
		expect(client.delete.mock.calls[0]![1]).toEqual(['user-1'])
	})

	it('clears an older queued deletion after a fresh verified deletion', async () => {
		const client = makeFakeClient()
		let hasLocalAccount = true
		client.getLocalAccount.mockImplementation(async () => (hasLocalAccount ? SNAPSHOT : null))
		client.delete.mockImplementation(async () => {
			hasLocalAccount = false
			return { serverId: 'srv', deletedSubjectIds: ['user-1'], disconnectedSessions: 0 }
		})
		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', Date.now())

		await MumbleDO.prototype.deleteAccounts.call(fakeThis as any, 'srv', ['user-1'], 'admin_manual')

		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
	})

	it('removes a projection-only orphan after the local account is already gone', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		let projected = true
		client.getUserState.mockImplementation(async () => ({
			serverId: 'srv',
			users: projected ? [{ ...SNAPSHOT, murmurUserId: 861 }] : [],
		}))
		client.deleteProjectedUser.mockImplementation(async () => {
			projected = false
		})

		const result = await MumbleDO.prototype.deleteAccounts.call(
			makeFakeThis(client) as any,
			'srv',
			['user-1'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: ['user-1'], notFound: [], queued: [] })
		expect(client.delete).not.toHaveBeenCalled()
		expect(client.deleteProjectedUser).toHaveBeenCalledWith('srv', 'user-1')
	})

	it('queues a projection-only orphan while safe control deletion is disabled', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.getUserState.mockResolvedValue({
			serverId: 'srv',
			users: [{ ...SNAPSHOT, murmurUserId: 861 }],
		})
		const fakeThis = makeFakeThis(client, { env: {} })

		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: [], notFound: [], queued: ['user-1'] })
		expect(client.deleteProjectedUser).not.toHaveBeenCalled()
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
	})

	it('repairs a projection left behind by a successful local delete', async () => {
		const client = makeFakeClient()
		let hasLocalAccount = true
		let projected = true
		client.getLocalAccount.mockImplementation(async () => (hasLocalAccount ? SNAPSHOT : null))
		client.getUserState.mockImplementation(async () => ({
			serverId: 'srv',
			users: projected ? [{ ...SNAPSHOT, murmurUserId: 861 }] : [],
		}))
		client.delete.mockImplementation(async () => {
			hasLocalAccount = false
			return { serverId: 'srv', deletedSubjectIds: ['user-1'], disconnectedSessions: 0 }
		})
		client.deleteProjectedUser.mockImplementation(async () => {
			projected = false
		})

		const result = await MumbleDO.prototype.deleteAccounts.call(
			makeFakeThis(client) as any,
			'srv',
			['user-1'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: ['user-1'], notFound: [], queued: [] })
		expect(client.deleteProjectedUser).toHaveBeenCalledWith('srv', 'user-1')
	})

	it('queues an orphan when projection repair does not persist', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.getUserState.mockResolvedValue({
			serverId: 'srv',
			users: [{ ...SNAPSHOT, murmurUserId: 861 }],
		})
		const fakeThis = makeFakeThis(client)

		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: [], notFound: [], queued: ['user-1'] })
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
	})

	it('queues an unconfirmed control deletion without treating it as notFound', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		client.delete.mockResolvedValue({
			serverId: 'srv',
			deletedSubjectIds: [],
			disconnectedSessions: 0,
		})
		const fakeThis = makeFakeThis(client)

		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: [], notFound: [], queued: ['user-1'] })
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
	})

	it('queues only the unresolved suffix after a verified deletion', async () => {
		const client = makeFakeClient()
		const local = new Set(['user-1', 'user-2'])
		client.getLocalAccount.mockImplementation(async (_serverId: string, subjectId: string) =>
			local.has(subjectId) ? { ...SNAPSHOT, subjectId } : null
		)
		client.delete.mockImplementation(async (_serverId: string, subjectIds: string[]) => {
			if (subjectIds[0] === 'user-2') throw new Error('control unavailable')
			local.delete('user-1')
			return { serverId: 'srv', deletedSubjectIds: ['user-1'], disconnectedSessions: 0 }
		})
		const fakeThis = makeFakeThis(client)

		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1', 'user-2'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: ['user-1'], notFound: [], queued: ['user-2'] })
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-2')).toBe(true)
	})

	it('persists a failed subject before continuing to a later successful deletion', async () => {
		const client = makeFakeClient()
		const fakeThis = makeFakeThis(client)
		let secondLocalExists = true
		client.getLocalAccount.mockImplementation(async (_serverId: string, subjectId: string) => {
			if (subjectId === 'user-1') throw new Error('first lookup failed')
			expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
			return secondLocalExists ? { ...SNAPSHOT, subjectId } : null
		})
		client.delete.mockImplementation(async () => {
			secondLocalExists = false
			return { serverId: 'srv', deletedSubjectIds: ['user-2'], disconnectedSessions: 0 }
		})

		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1', 'user-2'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: ['user-2'], notFound: [], queued: ['user-1'] })
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-2')).toBe(false)
	})

	it('queues unresolved subjects for alarm retry when murmur-control fails', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		client.delete.mockRejectedValue(new Error('connection refused'))

		const fakeThis = makeFakeThis(client)
		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1'],
			'admin_manual'
		)

		expect(result).toEqual({ deleted: [], notFound: [], queued: ['user-1'] })
		// Pending deletion persisted and alarm armed
		expect(fakeThis.state.storage.put).toHaveBeenCalledTimes(1)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(fakeThis.state.storage.setAlarm).toHaveBeenCalledTimes(1)
	})

	it('moves a later user-sync alarm forward for a newly queued deletion', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockRejectedValue(new Error('control unavailable'))
		const fakeThis = makeFakeThis(client)
		await fakeThis.state.storage.setAlarm(Date.now() + 60 * 60 * 1000)

		await MumbleDO.prototype.deleteAccounts.call(fakeThis as any, 'srv', ['user-1'], 'offboarding')

		expect(await fakeThis.state.storage.getAlarm()).toBeLessThan(Date.now() + 6 * 60 * 1000)
	})

	it('queues all subjects when even the existence pre-check fails', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockRejectedValue(new Error('connection refused'))

		const fakeThis = makeFakeThis(client)
		const result = await MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1', 'user-2'],
			'admin_manual'
		)

		expect(result.queued).toEqual(['user-1', 'user-2'])
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-2')).toBe(true)
	})
})

describe('MumbleDO.alarm', () => {
	it('cancels a queued offboarding deletion when Core says the user is eligible', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		const fakeThis = makeFakeThis(client)
		fakeThis.env.CORE.decideMumbleDeleteRetry.mockResolvedValue('cancel')
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', {
			intent: 'offboarding',
			requestedAt: Date.now(),
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(fakeThis.env.CORE.decideMumbleDeleteRetry).toHaveBeenCalledWith(
			'srv',
			'user-1',
			'offboarding'
		)
		expect(client.delete).not.toHaveBeenCalled()
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
	})

	it('cancels a legacy deletion when Core says the user is eligible', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		const fakeThis = makeFakeThis(client)
		fakeThis.env.CORE.decideMumbleDeleteRetry.mockResolvedValue('cancel')
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', Date.now())

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(client.delete).not.toHaveBeenCalled()
		expect(fakeThis.env.CORE.decideMumbleDeleteRetry).toHaveBeenCalledWith(
			'srv',
			'user-1',
			'offboarding'
		)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
	})

	it('retries a legacy deletion only after current Core eligibility rejects the user', async () => {
		const client = makeFakeClient()
		let hasLocalAccount = true
		client.getLocalAccount.mockImplementation(async () => (hasLocalAccount ? SNAPSHOT : null))
		client.delete.mockImplementation(async () => {
			hasLocalAccount = false
			return { serverId: 'srv', deletedSubjectIds: ['user-1'], disconnectedSessions: 0 }
		})
		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', Date.now())

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(fakeThis.env.CORE.decideMumbleDeleteRetry).toHaveBeenCalledWith(
			'srv',
			'user-1',
			'offboarding'
		)
		expect(client.delete).toHaveBeenCalledWith('srv', ['user-1'])
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
	})

	it('checks a legacy temp-op guest against terminal state before retrying', async () => {
		const client = makeFakeClient()
		const fakeThis = makeFakeThis(client)
		fakeThis.env.CORE.decideMumbleDeleteRetry.mockResolvedValue('defer')
		const subjectId = 'tempop:operation-1:9001'
		fakeThis.state.storage.data.set(`pending-delete:srv:${subjectId}`, Date.now())

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(fakeThis.env.CORE.decideMumbleDeleteRetry).toHaveBeenCalledWith(
			'srv',
			subjectId,
			'tempop_terminal'
		)
		expect(client.delete).not.toHaveBeenCalled()
		expect(fakeThis.state.storage.data.has(`pending-delete:srv:${subjectId}`)).toBe(true)
	})

	it('defers without touching control when Core is unavailable', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		const fakeThis = makeFakeThis(client)
		fakeThis.env.CORE.decideMumbleDeleteRetry.mockRejectedValue(new Error('Core unavailable'))
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', {
			intent: 'offboarding',
			requestedAt: Date.now(),
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(client.delete).not.toHaveBeenCalled()
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(await fakeThis.state.storage.getAlarm()).not.toBeNull()
	})

	it('keeps an alarm armed when a deletion is queued during alarm cleanup', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockRejectedValue(new Error('control unavailable'))
		const fakeThis = makeFakeThis(client)
		const originalList = fakeThis.state.storage.list.getMockImplementation()!
		let releaseList!: () => void
		const listPaused = new Promise<void>((resolve) => {
			releaseList = resolve
		})
		let enteredList!: () => void
		const listEntered = new Promise<void>((resolve) => {
			enteredList = resolve
		})
		fakeThis.state.storage.list.mockImplementationOnce(async (options: { prefix: string }) => {
			enteredList()
			await listPaused
			return originalList(options)
		})

		const alarm = (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)
		await listEntered
		const deletion = MumbleDO.prototype.deleteAccounts.call(
			fakeThis as any,
			'srv',
			['user-1'],
			'admin_manual'
		)
		releaseList()
		await Promise.all([alarm, deletion])

		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(await fakeThis.state.storage.getAlarm()).not.toBeNull()
	})

	it('cleans up completed and abandoned user sync state', async () => {
		const client = makeFakeClient()
		const fakeThis = makeFakeThis(client)
		const now = Date.now()
		fakeThis.state.storage.data.set('user-sync:completed', {
			completedAt: now - 301_000,
			cooldownMs: 300_000,
			leaseToken: null,
			leaseUntil: 0,
			cleanupAt: now - 1,
		})
		fakeThis.state.storage.data.set('user-sync:abandoned', {
			completedAt: 0,
			cooldownMs: 300_000,
			leaseToken: 'stale-lease',
			leaseUntil: now - 1,
			cleanupAt: now - 1,
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(fakeThis.state.storage.data.has('user-sync:completed')).toBe(false)
		expect(fakeThis.state.storage.data.has('user-sync:abandoned')).toBe(false)
		expect(fakeThis.state.storage.deleteAlarm).toHaveBeenCalledTimes(1)
	})

	it('retries queued deletions and clears confirmed entries', async () => {
		const client = makeFakeClient()
		let hasLocalAccount = true
		client.getLocalAccount.mockImplementation(async () => (hasLocalAccount ? SNAPSHOT : null))
		client.delete.mockImplementation(async () => {
			hasLocalAccount = false
			return { serverId: 'srv', deletedSubjectIds: ['user-1'], disconnectedSessions: 0 }
		})

		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', {
			intent: 'offboarding',
			requestedAt: Date.now(),
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(client.delete).toHaveBeenCalledTimes(1)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
		// Queue drained — no follow-up alarm
		expect(fakeThis.state.storage.setAlarm).not.toHaveBeenCalled()
	})

	it('preserves colons in a queued temp-op guest subject ID', async () => {
		const client = makeFakeClient()
		const subjectId = 'tempop:operation-1:9001'
		let hasLocalAccount = true
		client.getLocalAccount.mockImplementation(async (serverId: string, requestedId: string) =>
			serverId === 'srv' && requestedId === subjectId && hasLocalAccount
				? { ...SNAPSHOT, subjectId }
				: null
		)
		client.delete.mockImplementation(async () => {
			hasLocalAccount = false
			return { serverId: 'srv', deletedSubjectIds: [subjectId], disconnectedSessions: 0 }
		})
		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set(`pending-delete:srv:${subjectId}`, {
			intent: 'tempop_terminal',
			requestedAt: Date.now(),
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(client.delete).toHaveBeenCalledWith('srv', [subjectId])
		expect(fakeThis.state.storage.data.has(`pending-delete:srv:${subjectId}`)).toBe(false)
	})

	it('does not repair a projection-only orphan while the safety gate is disabled', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(null)
		client.getUserState.mockResolvedValue({
			serverId: 'srv',
			users: [{ ...SNAPSHOT, murmurUserId: 861 }],
		})
		const fakeThis = makeFakeThis(client)
		fakeThis.env.MUMBLE_CONTROL_SAFE_PROJECTION_DELETE = 'false'
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', {
			intent: 'offboarding',
			requestedAt: Date.now(),
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(client.deleteProjectedUser).not.toHaveBeenCalled()
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
	})

	it('reschedules the alarm while deletions keep failing', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockRejectedValue(new Error('still down'))

		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', {
			intent: 'offboarding',
			requestedAt: Date.now(),
		})

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(fakeThis.state.storage.setAlarm).toHaveBeenCalledTimes(1)
	})
})

describe('MumbleDO mutation serialization', () => {
	it('serializes concurrent provisions so the second sees the first account', async () => {
		const client = makeFakeClient()
		// Simulated remote state: account exists only after a batchSync lands
		let stored: typeof SNAPSHOT | null = null
		client.getLocalAccount.mockImplementation(async () => stored)
		client.getUserState.mockResolvedValue({ serverId: 'srv', users: [] })
		client.batchSync.mockImplementation(async () => {
			// Yield first so an unserialized implementation would interleave here
			await new Promise((resolve) => setTimeout(resolve, 5))
			stored = SNAPSHOT
			return { serverId: 'srv', updated: [SNAPSHOT] }
		})

		const fakeThis = makeFakeThis(client)
		const input = {
			subjectId: 'user-1',
			loginName: 'Pilot One',
			displayName: 'Pilot One',
			groups: ['alpha'],
		}

		const [first, second] = await Promise.allSettled([
			MumbleDO.prototype.provisionAccount.call(fakeThis as any, 'srv', input),
			MumbleDO.prototype.provisionAccount.call(fakeThis as any, 'srv', input),
		])

		// Exactly one provision succeeds; the other gets a typed already_exists
		expect(first!.status).toBe('fulfilled')
		expect(second!.status).toBe('rejected')
		expect(parseMumbleError((second as PromiseRejectedResult).reason)?.code).toBe('already_exists')
		expect(client.batchSync).toHaveBeenCalledTimes(1)
	})
})
