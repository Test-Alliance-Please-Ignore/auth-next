import { describe, expect, it, vi } from 'vitest'

import { createEmailContext } from '../email'
import { awardAndAnnounce, BONUS_HEADINGS, BONUS_MESSAGES } from '../markee-bonus'
import { fakeExecutionCtx, makeMessage } from './make-message'

import type { Env } from '../context'
import type { EmailLogger } from '../email'
import type { DiscordProfile } from '@repo/discord'
import type { AwardBonusResult } from '@repo/prediction-markets'

type AwardMock = ReturnType<typeof vi.fn<() => Promise<AwardBonusResult>>>
type ProfileMock = ReturnType<typeof vi.fn<() => Promise<DiscordProfile | null>>>

/**
 * Build an Env whose PREDICTION_MARKETS binding resolves (via getStub's idFromName + get) to a stub
 * with the given `awardRandomBonus`, and whose DISCORD binding resolves (via forDO().singleton() →
 * getByName) to a stub with the given `getProfileByCoreUserId`.
 */
function envWith(
	awardRandomBonus: AwardMock,
	getProfileByCoreUserId: ProfileMock,
	overrides: Partial<Env> = {}
): Env {
	return {
		PREDICTION_MARKETS: { idFromName: (name: string) => name, get: () => ({ awardRandomBonus }) },
		DISCORD: { getByName: () => ({ getProfileByCoreUserId }) },
		...overrides,
	} as unknown as Env
}

function ctxFor(env: Env, log: EmailLogger) {
	const message = makeMessage({ to: 'markeedragon@pleaseignore.app', from: 'sender@example.com' })
	return createEmailContext(message, env, fakeExecutionCtx(), log)
}

const makeLog = (): EmailLogger => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
const profile = (userId: string): DiscordProfile => ({
	userId,
	username: 'winner',
	discriminator: '0',
	scopes: [],
})

/**
 * True when `content`'s body line is one of the predefined openers followed by `name`. The body is
 * the last line — an optional heading (from BONUS_HEADINGS) precedes it on its own line when configured.
 */
function isAnnouncementFor(content: string | null, name: string): boolean {
	if (content === null) return false
	const body = content.slice(content.lastIndexOf('\n') + 1)
	return BONUS_MESSAGES.some((m) => body === `${m} ${name}`)
}

const awardOk = (over: Partial<Extract<AwardBonusResult, { awarded: true }>> = {}): AwardMock =>
	vi.fn<() => Promise<AwardBonusResult>>().mockResolvedValue({
		awarded: true,
		userId: 'core-1',
		amount: '7',
		balanceAfter: '107',
		...over,
	})

describe('awardAndAnnounce', () => {
	it('announces a random opener followed by the winner mention (their display name)', async () => {
		const award = awardOk()
		const getProfile = vi
			.fn<() => Promise<DiscordProfile | null>>()
			.mockResolvedValue(profile('999'))
		const log = makeLog()

		const content = await awardAndAnnounce(
			ctxFor(envWith(award, getProfile, { MARKEE_BONUS_AMOUNT: '7' }), log)
		)

		expect(isAnnouncementFor(content, '<@999>')).toBe(true) // <opener> <@discordId> (mention + ping)
		// Heading: none while BONUS_HEADINGS is empty (single-line body); once configured, a random one
		// (which may itself span multiple lines) is prepended above the body as `<heading>\n<body>`.
		if (BONUS_HEADINGS.length === 0) {
			expect(content).not.toContain('\n')
		} else {
			expect(BONUS_HEADINGS.some((h) => (content ?? '').startsWith(`${h}\n`))).toBe(true)
		}
		expect(award).toHaveBeenCalledWith({
			amount: '7',
			reason: 'markeedragon@ inbound email from sender@example.com',
		})
		expect(getProfile).toHaveBeenCalledWith('core-1') // resolved by the winner's core user id
		expect(log.error).not.toHaveBeenCalled()
	})

	it('falls back to a generic label when the winner has no linked Discord profile', async () => {
		const getProfile = vi.fn<() => Promise<DiscordProfile | null>>().mockResolvedValue(null)
		const content = await awardAndAnnounce(ctxFor(envWith(awardOk(), getProfile), makeLog()))
		expect(isAnnouncementFor(content, 'a lucky member')).toBe(true)
	})

	it('still announces (generic label) when resolving the display name throws', async () => {
		const getProfile = vi
			.fn<() => Promise<DiscordProfile | null>>()
			.mockRejectedValue(new Error('discord down'))
		const log = makeLog()
		const content = await awardAndAnnounce(ctxFor(envWith(awardOk(), getProfile), log))
		expect(isAnnouncementFor(content, 'a lucky member')).toBe(true)
		expect(log.error).toHaveBeenCalledWith(
			'resolving markee bonus winner name failed (continuing)',
			expect.objectContaining({ coreUserId: 'core-1' })
		)
	})

	it('returns null (and never resolves a name) when no one was bonused', async () => {
		const award = vi
			.fn<() => Promise<AwardBonusResult>>()
			.mockResolvedValue({ awarded: false, reason: 'INSUFFICIENT_HOUSE_FUNDS' })
		const getProfile = vi.fn<() => Promise<DiscordProfile | null>>()
		const content = await awardAndAnnounce(ctxFor(envWith(award, getProfile), makeLog()))
		expect(content).toBeNull()
		expect(getProfile).not.toHaveBeenCalled()
	})

	it('returns null and never throws when the award DO call fails', async () => {
		const award = vi.fn<() => Promise<AwardBonusResult>>().mockRejectedValue(new Error('DO down'))
		const getProfile = vi.fn<() => Promise<DiscordProfile | null>>()
		const log = makeLog()
		await expect(awardAndAnnounce(ctxFor(envWith(award, getProfile), log))).resolves.toBeNull()
		expect(getProfile).not.toHaveBeenCalled()
		expect(log.error).toHaveBeenCalledWith(
			'markee bonus award failed (continuing)',
			expect.objectContaining({ error: 'DO down' })
		)
	})

	it('falls back to the default amount when MARKEE_BONUS_AMOUNT is unset', async () => {
		const award = vi
			.fn<() => Promise<AwardBonusResult>>()
			.mockResolvedValue({ awarded: false, reason: 'NO_ELIGIBLE_WALLETS' })
		await awardAndAnnounce(ctxFor(envWith(award, vi.fn()), makeLog()))
		expect(award).toHaveBeenCalledWith(expect.objectContaining({ amount: '5' }))
	})
})
