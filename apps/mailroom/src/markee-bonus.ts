import { forDO, getStub } from '@repo/do-utils'

import { errorMessage } from './email'

import type { Discord } from '@repo/discord'
import type { PredictionMarkets } from '@repo/prediction-markets'
import type { Env } from './context'
import type { EmailContext } from './email'

/** Fallback bonus (points) used when `MARKEE_BONUS_AMOUNT` is unset. Small by design. */
const DEFAULT_BONUS_AMOUNT = '5'

/**
 * Predefined celebratory openers for the bonus announcement. One is chosen at random and the winner's
 * display name is appended (see {@link awardAndAnnounce}). Each states WHY the bonus is being paid — a
 * Markee Dragon referral/affiliate sale generated a commission, so the house shares points with a
 * random member — so the announcement is self-explanatory even when no {@link BONUS_HEADINGS} is set.
 * These are sent as Discord message *content*, so both unicode emoji AND custom guild emotes render —
 * drop `<:name:id>` / `<a:name:id>` syntax in here (using the real emote id from this guild) and it
 * comes across as a live emote.
 */
export const BONUS_MESSAGES: readonly string[] = [
	'🎉 A Markee Dragon referral sale just landed, so bonus points go to',
	'💰 Our referral link earned a commission — sharing the winnings with',
	'✨ Someone bought game codes through our code, so a bonus flies to',
	'🍀 A Markee Dragon affiliate sale means free points for',
	'🎁 Thanks to a referral purchase, the house is gifting points to',
	'🚀 Referral commission in the bank — bonus points launched to',
	'🏆 A Markee Dragon sale just paid out, and the lucky winner is',
	'📬 A referral order came through, so points are headed to',
]

/**
 * Optional heading lines for the bonus announcement. When non-empty, one is chosen at random and
 * rendered on its OWN line above the opener+winner line (see {@link awardAndAnnounce}); while empty
 * (the default) the announcement is just the opener + winner, exactly as before. Same content-rendering
 * rules as {@link BONUS_MESSAGES} — unicode emoji and custom `<:name:id>` emotes both render.
 */
export const BONUS_HEADINGS: readonly string[] = [
	'📣 Someone just used our referral code to buy ETCs from **Markee Dragon**!\n' +
		'Get your own at <https://etc.pleaseignore.com> — use code **tapi** for a discount.\n',
]

/**
 * Plain sale notices for when no bonus was awarded (no eligible wallet / empty house / a failure).
 * One is chosen at random and posted with {@link FALLBACK_FOOTER} appended on its own line (see
 * {@link pickFallbackMessage}). Standalone by design — no winner name is appended. Same
 * content-rendering rules as {@link BONUS_MESSAGES} — unicode emoji and custom `<:name:id>` emotes
 * both render.
 */
export const FALLBACK_MESSAGES: readonly string[] = [
	'📣 A Markee Dragon referral sale just came in!',
	'💸 Cha-ching — a Markee Dragon referral sale just landed!',
	'🛒 Someone just bought through our Markee Dragon referral link!',
	'📈 Another Markee Dragon referral sale is in the books!',
	'🎊 Our Markee Dragon referral code just got used again!',
	'🪙 A referral commission just rolled in from Markee Dragon!',
]

/**
 * Footer line appended to every fallback post. The URL is wrapped in `<…>` so Discord suppresses the
 * link-preview embed, same as in {@link BONUS_HEADINGS}.
 */
export const FALLBACK_FOOTER = '<https://etc.pleaseignore.com> - use code `tapi` for 3% off'

/** Pick a random predefined opener. */
function pickBonusMessage(): string {
	return BONUS_MESSAGES[Math.floor(Math.random() * BONUS_MESSAGES.length)]
}

/** Pick a random heading, or `null` when none are configured (so no heading line is rendered). */
function pickBonusHeading(): string | null {
	if (BONUS_HEADINGS.length === 0) return null
	return BONUS_HEADINGS[Math.floor(Math.random() * BONUS_HEADINGS.length)]
}

/**
 * Build the no-award fallback post: a random {@link FALLBACK_MESSAGES} notice with
 * {@link FALLBACK_FOOTER} on its own line below.
 */
export function pickFallbackMessage(): string {
	const notice = FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)]
	return `${notice}\n${FALLBACK_FOOTER}`
}

/**
 * Award a random prediction-market wallet a small bonus (paid from the house wallet, atomically inside
 * the PM Durable Object) and return a Discord announcement naming the winner — or `null` when no one
 * was bonused (no eligible wallet / empty house / a failure).
 *
 * The announcement is `<random opener> <display name>`, where the display name is a Discord *mention*
 * of the winner (`<@discordUserId>`) — which renders as their current display name and pings them —
 * resolved from their core user id via the Discord DO. It falls back to a generic label if the winner
 * has no linked Discord account. When {@link BONUS_HEADINGS} is non-empty, a random heading is
 * prepended on its own line (`<heading>\n<opener> <display name>`).
 *
 * Best-effort by contract: every failure (a misconfigured binding, either DO being down, an invalid
 * amount) is swallowed and logged and yields `null`, so this can NEVER bounce, delay past a single RPC,
 * or misroute the mail. The caller uses the returned string as the post's content when present.
 */
export async function awardAndAnnounce(ctx: EmailContext<Env>): Promise<string | null> {
	const winnerUserId = await awardBonus(ctx)
	if (!winnerUserId) return null
	const displayName = await resolveWinnerName(ctx, winnerUserId)
	const body = `${pickBonusMessage()} ${displayName}`
	const heading = pickBonusHeading()
	return heading ? `${heading}\n${body}` : body
}

/**
 * Award the bonus and return the winning core user id, or `null` if nothing was awarded. Never throws.
 */
async function awardBonus(ctx: EmailContext<Env>): Promise<string | null> {
	try {
		// Coerce + read INSIDE the try: wrangler `vars` are untyped JSON, so a mis-set numeric
		// `MARKEE_BONUS_AMOUNT` (e.g. `5` not `"5"`) would make a bare `.trim()` throw. `String(...)`
		// normalizes it, and being inside the try means any bad config is swallowed like every other
		// failure — preserving the never-throws contract. A non-integer string reaches the DO, which
		// rejects it (INVALID_AMOUNT), and that rejection is caught here too.
		const amount = String(ctx.env.MARKEE_BONUS_AMOUNT ?? DEFAULT_BONUS_AMOUNT).trim()
		const prediction = getStub<PredictionMarkets>(ctx.env.PREDICTION_MARKETS, 'default')
		const result = await prediction.awardRandomBonus({
			amount,
			reason: `markeedragon@ inbound email from ${ctx.sender}`,
		})
		if (result.awarded) {
			ctx.log.info('markee bonus awarded to a random wallet', {
				userId: result.userId,
				amount: result.amount,
				balanceAfter: result.balanceAfter,
			})
			return result.userId
		}
		// Expected no-ops (no wallets yet, or an empty house wallet) — informational, not an error.
		ctx.log.info('markee bonus skipped', { reason: result.reason, amount })
		return null
	} catch (error) {
		ctx.log.error('markee bonus award failed (continuing)', { error: errorMessage(error) })
		return null
	}
}

/**
 * Resolve a winner's core user id to a display name for the announcement. Returns a Discord mention
 * (`<@discordUserId>`, which renders as the user's display name and pings them) when the account is
 * linked, else a generic label. Never throws.
 */
async function resolveWinnerName(ctx: EmailContext<Env>, coreUserId: string): Promise<string> {
	try {
		const discord = forDO<Discord>(ctx.env.DISCORD).singleton()
		const profile = await discord.getProfileByCoreUserId(coreUserId)
		if (profile?.userId) return `<@${profile.userId}>`
		ctx.log.info('markee bonus winner has no linked Discord profile', { coreUserId })
	} catch (error) {
		ctx.log.error('resolving markee bonus winner name failed (continuing)', {
			error: errorMessage(error),
			coreUserId,
		})
	}
	return 'a lucky member'
}
