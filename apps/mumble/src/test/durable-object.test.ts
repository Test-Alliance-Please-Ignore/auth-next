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
}

function makeFakeClient(): FakeClient {
	return {
		getLocalAccount: vi.fn(),
		getUserState: vi.fn(),
		batchSync: vi.fn(),
		assignGroups: vi.fn(),
		enable: vi.fn(),
		disable: vi.fn(),
		delete: vi.fn(),
	}
}

function makeFakeStorage() {
	const data = new Map<string, unknown>()
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
		getAlarm: vi.fn(async () => null),
		setAlarm: vi.fn(async () => undefined),
		deleteAlarm: vi.fn(async () => undefined),
	}
}

function makeFakeThis(client: FakeClient, overrides: Record<string, unknown> = {}) {
	const proto = MumbleDO.prototype as unknown as Record<string, unknown>
	return {
		env: {},
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
		deleteAccountsInner: proto.deleteAccountsInner,
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
		// 250 provisioned assignments => 2 chunks of <=200
		expect(client.assignGroups).toHaveBeenCalledTimes(2)
		expect(client.assignGroups.mock.calls[0]![1]).toHaveLength(200)
		expect(client.assignGroups.mock.calls[1]![1]).toHaveLength(50)
		expect(result.synced).toHaveLength(250)
		expect(result.skipped).toEqual(['queued-user', 'unprovisioned'])
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

describe('MumbleDO.deleteAccounts', () => {
	it('pre-filters missing accounts and reports them as notFound', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockImplementation(async (_serverId: string, subjectId: string) =>
			subjectId === 'user-1' ? SNAPSHOT : null
		)
		client.delete.mockResolvedValue({
			serverId: 'srv',
			deletedSubjectIds: ['user-1'],
			disconnectedSessions: 1,
		})

		const result = await MumbleDO.prototype.deleteAccounts.call(
			makeFakeThis(client) as any,
			'srv',
			['user-1', 'user-2']
		)

		expect(result).toEqual({ deleted: ['user-1'], notFound: ['user-2'], queued: [] })
		expect(client.delete).toHaveBeenCalledTimes(1)
		expect(client.delete.mock.calls[0]![1]).toEqual(['user-1'])
	})

	it('queues unresolved subjects for alarm retry when murmur-control fails', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		client.delete.mockRejectedValue(new Error('connection refused'))

		const fakeThis = makeFakeThis(client)
		const result = await MumbleDO.prototype.deleteAccounts.call(fakeThis as any, 'srv', ['user-1'])

		expect(result).toEqual({ deleted: [], notFound: [], queued: ['user-1'] })
		// Pending deletion persisted and alarm armed
		expect(fakeThis.state.storage.put).toHaveBeenCalledTimes(1)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(fakeThis.state.storage.setAlarm).toHaveBeenCalledTimes(1)
	})

	it('queues all subjects when even the existence pre-check fails', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockRejectedValue(new Error('connection refused'))

		const fakeThis = makeFakeThis(client)
		const result = await MumbleDO.prototype.deleteAccounts.call(fakeThis as any, 'srv', [
			'user-1',
			'user-2',
		])

		expect(result.queued).toEqual(['user-1', 'user-2'])
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(true)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-2')).toBe(true)
	})
})

describe('MumbleDO.alarm', () => {
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
		client.getLocalAccount.mockResolvedValue(SNAPSHOT)
		client.delete.mockResolvedValue({
			serverId: 'srv',
			deletedSubjectIds: ['user-1'],
			disconnectedSessions: 0,
		})

		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', Date.now())

		await (MumbleDO.prototype.alarm as () => Promise<void>).call(fakeThis as any)

		expect(client.delete).toHaveBeenCalledTimes(1)
		expect(fakeThis.state.storage.data.has('pending-delete:srv:user-1')).toBe(false)
		// Queue drained — no follow-up alarm
		expect(fakeThis.state.storage.setAlarm).not.toHaveBeenCalled()
	})

	it('reschedules the alarm while deletions keep failing', async () => {
		const client = makeFakeClient()
		client.getLocalAccount.mockRejectedValue(new Error('still down'))

		const fakeThis = makeFakeThis(client)
		fakeThis.state.storage.data.set('pending-delete:srv:user-1', Date.now())

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
