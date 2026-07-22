import { describe, expect, it, beforeEach, vi } from 'vitest'

import { getStub } from '@repo/do-utils'
import { CoreDO } from '../durable-object'
import {
	buildImmunitasAccessAlertMessage,
	IMMUNITAS_ALERT_COOLDOWN_MS,
	shouldRetryImmunitasAccessAlertDelivery,
} from '../lib/immunitas-alerts'

import type { Discord } from '@repo/discord'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)

function createDbMock() {
	return {
		query: {
			users: {
				findFirst: vi.fn(),
			},
		},
	}
}

describe('immunitas alerts message builder', () => {
	it('groups requestors by accessor user in the attempted by field', () => {
		const message = buildImmunitasAccessAlertMessage({
			accessType: 'fulcrum-report',
			targetCharacterLabels: ['Target Pilot One', 'Target Pilot Two'],
			requestorGroups: [
				{
					requestorUserId: 'requestor-1',
					requestorLabels: ['Requester Alpha', 'Requester Alpha Alt'],
					attemptCount: 2,
				},
				{
					requestorUserId: 'requestor-2',
					requestorLabels: ['Requester Beta'],
					attemptCount: 1,
				},
			],
			attemptCount: 3,
			updatedAt: new Date('2026-06-21T00:00:00.000Z'),
		})

		expect(message.embeds?.[0]).toMatchObject({
			title: 'Unauthorized fulcrum report access blocked',
			timestamp: '2026-06-21T00:00:00.000Z',
			color: 0xef4444,
		})
		expect(message.embeds?.[0]?.fields?.[2]?.name).toBe('Attempted By')
		expect(message.embeds?.[0]?.fields?.[2]?.value).toContain(
			'• Requester Alpha (2 blocked attempts)'
		)
		expect(message.embeds?.[0]?.fields?.[2]?.value).toContain('  - Requester Alpha Alt')
		expect(message.embeds?.[0]?.fields?.[2]?.value).toContain(
			'• Requester Beta (1 blocked attempt)'
		)
	})

	it('colors profile alerts differently from fulcrum alerts', () => {
		const message = buildImmunitasAccessAlertMessage({
			accessType: 'profile-data',
			targetCharacterLabels: ['Target Pilot'],
			requestorGroups: [
				{
					requestorUserId: 'requestor-1',
					requestorLabels: ['Requester Alpha'],
					attemptCount: 1,
				},
			],
			attemptCount: 1,
			updatedAt: new Date('2026-06-21T00:00:00.000Z'),
		})

		expect(message.embeds?.[0]).toMatchObject({
			title: 'Unauthorized profile data access blocked',
			color: 0xf59e0b,
		})
	})
})

describe('immunitas alert delivery retry policy', () => {
	it('treats 401/403-style discord failures and missing permissions as fatal', () => {
		expect(
			shouldRetryImmunitasAccessAlertDelivery({
				error: 'Discord API error: 401',
			})
		).toBe(false)
		expect(
			shouldRetryImmunitasAccessAlertDelivery({
				error: 'Discord API error: 403',
			})
		).toBe(false)
		expect(
			shouldRetryImmunitasAccessAlertDelivery({
				error: 'Missing permissions to send DM to this user',
			})
		).toBe(false)
		expect(
			shouldRetryImmunitasAccessAlertDelivery({
				error: 'Discord API error: 500',
			})
		).toBe(true)
	})
})

describe('CoreDO immunitas alert draining', () => {
	const createState = () =>
		({
			storage: {
				delete: vi.fn().mockResolvedValue(undefined),
				put: vi.fn().mockResolvedValue(undefined),
				deleteAlarm: vi.fn().mockResolvedValue(undefined),
			},
		}) as any

	const createCore = (discordStub: { sendDirectMessage: ReturnType<typeof vi.fn> }) => {
		const core = Object.create(CoreDO.prototype) as CoreDO
		const db = createDbMock()
		;(core as any).env = { DISCORD: {} as DurableObjectNamespace }
		;(core as any).state = createState()
		;(core as any).getDb = vi.fn().mockReturnValue(db)
		;(core as any).scheduleImmunitasAccessAlertAlarm = vi.fn().mockResolvedValue(undefined)
		;(core as any).pendingImmunitasAccessAlerts = new Map([
			[
				'core-user:fulcrum-report',
				{
					expiresAt: Date.now() + 60_000,
					pendingTargetCharacterLabels: ['Target Pilot'],
					pendingRequestorGroups: [
						{
							requestorUserId: 'requestor-1',
							requestorLabels: ['Requester One'],
							attemptCount: 1,
						},
					],
					lastNotifiedAt: null,
					nextEligibleAt: 0,
					attemptCount: 1,
					lastError: undefined,
					source: 'test',
					accessType: 'fulcrum-report' as const,
					targetUserId: 'core-user',
				},
			],
		])
		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === (core as any).env.DISCORD) return discordStub as unknown as Discord
			throw new Error('Unexpected binding')
		})
		return { core, db }
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('evicts the queue entry after a successful Discord send', async () => {
		const discordStub = {
			sendDirectMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
		}
		const { core, db } = createCore(discordStub)
		db.query.users.findFirst.mockResolvedValue({ id: 'core-user', discordUserId: 'discord-user' })

		const result = await (core as any).processPendingImmunitasAccessAlerts()

		expect(result).toEqual({ processed: 1, sent: 1, failed: 0 })
		const entry = (core as any).pendingImmunitasAccessAlerts.get('core-user:fulcrum-report')
		expect(entry).toMatchObject({
			pendingTargetCharacterLabels: [],
			pendingRequestorGroups: [],
			lastNotifiedAt: expect.any(Number),
			attemptCount: 0,
			lastError: undefined,
		})
		expect(entry.nextEligibleAt).toBeGreaterThanOrEqual(Date.now() + IMMUNITAS_ALERT_COOLDOWN_MS - 1000)
		expect((core as any).state.storage.delete).not.toHaveBeenCalled()
		expect((core as any).state.storage.put).toHaveBeenCalledWith(
			expect.objectContaining({
				'pending-immunitas:core-user:fulcrum-report': expect.objectContaining({
					pendingTargetCharacterLabels: [],
					pendingRequestorGroups: [],
				}),
			})
		)
	})

	it('evicts the queue entry for fatal Discord failures instead of retrying', async () => {
		const discordStub = {
			sendDirectMessage: vi.fn().mockResolvedValue({
				success: false,
				error: 'Discord API error: 401',
			}),
		}
		const { core, db } = createCore(discordStub)
		db.query.users.findFirst.mockResolvedValue({ id: 'core-user', discordUserId: 'discord-user' })

		const result = await (core as any).processPendingImmunitasAccessAlerts()

		expect(result).toEqual({ processed: 1, sent: 0, failed: 1 })
		expect((core as any).pendingImmunitasAccessAlerts.has('core-user:fulcrum-report')).toBe(false)
		expect((core as any).state.storage.delete).toHaveBeenCalledWith(
			'pending-immunitas:core-user:fulcrum-report'
		)
		expect((core as any).state.storage.put).not.toHaveBeenCalled()
	})
})
