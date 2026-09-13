import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import { ImmunitasAlerts } from '../immunitas-alerts-do'
import {
	buildImmunitasAccessAlertMessage,
	shouldRetryImmunitasAccessAlertDelivery,
} from '../lib/immunitas-alerts'

import type { Discord } from '@repo/discord'

vi.mock('@repo/do-utils', () => ({ getStub: vi.fn() }))
vi.mock('../db', () => ({ createDb: vi.fn() }))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

class FakeStorage {
	private readonly values = new Map<string, unknown>()
	alarmAt: number | null = null
	async get<T>(key: string) {
		return structuredClone(this.values.get(key)) as T | undefined
	}
	async list<T>({ prefix }: { prefix?: string } = {}) {
		return new Map(
			[...this.values.entries()]
				.filter(([key]) => !prefix || key.startsWith(prefix))
				.map(([key, value]) => [key, structuredClone(value) as T])
		)
	}
	async put<T>(keyOrEntries: string | Record<string, T>, value?: T) {
		if (typeof keyOrEntries === 'string') this.values.set(keyOrEntries, structuredClone(value))
		else
			for (const [key, entry] of Object.entries(keyOrEntries))
				this.values.set(key, structuredClone(entry))
	}
	async delete(keyOrKeys: string | string[]) {
		for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) this.values.delete(key)
	}
	async transaction<T>(callback: (storage: this) => Promise<T>) {
		return callback(this)
	}
	async setAlarm(value: number | Date) {
		this.alarmAt = value instanceof Date ? value.getTime() : value
	}
	async deleteAlarm() {
		this.alarmAt = null
	}
}

const input = {
	targetUserId: 'target-user',
	targetCharacterLabel: 'Target Pilot',
	requestorUserId: 'requestor-user',
	requestorCharacterLabel: 'Requester',
	accessType: 'fulcrum-report' as const,
}
function createState(storage: FakeStorage) {
	return {
		storage,
		blockConcurrencyWhile: async (callback: () => Promise<void>) => callback(),
	} as any
}

describe('Immunitas alert formatting and retry policy', () => {
	it('groups requestors without displaying request counts', () => {
		const message = buildImmunitasAccessAlertMessage({
			accessType: 'fulcrum-report',
			targetCharacterLabels: ['Target Pilot'],
			requestorGroups: [{ requestorUserId: 'requestor-1', requestorLabels: ['Requester'] }],
			updatedAt: new Date('2026-06-21T00:00:00.000Z'),
		})
		expect(message.embeds?.[0]?.fields?.[2]?.name).toBe('Attempted By')
		expect(JSON.stringify(message)).not.toContain('attempt count')
	})
	it('treats authorization failures as fatal and server failures as retryable', () => {
		expect(shouldRetryImmunitasAccessAlertDelivery({ error: 'Discord API error: 401' })).toBe(false)
		expect(shouldRetryImmunitasAccessAlertDelivery({ error: 'Discord API error: 500' })).toBe(true)
	})
})

describe('ImmunitasAlerts', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		createDbMock.mockReturnValue({
			query: { users: { findFirst: vi.fn().mockResolvedValue({ discordUserId: 'discord-user' }) } },
		} as any)
	})
	it('aggregates alerts and arms the delayed alarm', async () => {
		const storage = new FakeStorage()
		getStubMock.mockReturnValue({ sendDirectMessage: vi.fn() } as unknown as Discord)
		const alerts = new ImmunitasAlerts(createState(storage), { DISCORD: {} } as any)
		await alerts.queueImmunitasAccessAlert(input)
		await alerts.queueImmunitasAccessAlert({ ...input, targetCharacterLabel: 'Second Pilot' })
		expect(storage.alarmAt).toBeGreaterThan(Date.now())
		expect((await alerts.reconcile()).scheduled).toBe(1)
	})
	it('delivers due alerts and schedules the cooldown', async () => {
		const storage = new FakeStorage()
		const discord = {
			sendDirectMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'message' }),
		}
		getStubMock.mockReturnValue(discord as unknown as Discord)
		const alerts = new ImmunitasAlerts(createState(storage), { DISCORD: {} } as any)
		await alerts.queueImmunitasAccessAlert(input)
		const payload = await storage.get<any>('immunitas-alert:payload:target-user:fulcrum-report')
		const duePayload = { ...payload, nextEligibleAt: 0 }
		await storage.put('immunitas-alert:payload:target-user:fulcrum-report', duePayload)
		await (alerts as any).queue.upsert('target-user:fulcrum-report', 0, duePayload)
		await alerts.alarm()
		expect(discord.sendDirectMessage).toHaveBeenCalledTimes(1)
		expect(storage.alarmAt).toBeGreaterThan(Date.now())
	})
	it('removes fatal delivery failures', async () => {
		const storage = new FakeStorage()
		const discord = {
			sendDirectMessage: vi
				.fn()
				.mockResolvedValue({ success: false, error: 'Discord API error: 401' }),
		}
		getStubMock.mockReturnValue(discord as unknown as Discord)
		const alerts = new ImmunitasAlerts(createState(storage), { DISCORD: {} } as any)
		await alerts.queueImmunitasAccessAlert(input)
		const payload = await storage.get<any>('immunitas-alert:payload:target-user:fulcrum-report')
		const duePayload = { ...payload, nextEligibleAt: 0 }
		await storage.put('immunitas-alert:payload:target-user:fulcrum-report', duePayload)
		await (alerts as any).queue.upsert('target-user:fulcrum-report', 0, duePayload)
		await alerts.alarm()
		expect(await storage.get('immunitas-alert:payload:target-user:fulcrum-report')).toBeUndefined()
	})
})
