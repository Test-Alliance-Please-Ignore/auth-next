/**
 * Discord component / modal-submit handling for prediction markets.
 *
 * - Member bet flow (P2): a "bet" button opens the stake modal (in the interactions worker);
 *   the modal submit runs placeBet and refreshes the post.
 * - Resolver flow (P3): Close/Approve buttons run directly; Resolve/Void buttons open a modal
 *   (outcome / reason) whose submit runs the write. Resolver actions gate on
 *   `urn:markets:resolver` (buttons are visible to all — gating is server-side).
 *
 * Core is the sole Discord orchestrator: it runs the PM write, then refreshes the public post
 * (embed + status buttons + tag + lock-on-terminal). The PM DO never calls Discord.
 */

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { captureException, logger } from '@repo/hono-helpers'

import { users } from '../db/schema'
import {
	BET_AMOUNT_INPUT_ID,
	customIdAction,
	decodeBetTarget,
	decodeMarketAction,
	decodeSingleMarketId,
	RESOLVE_OUTCOME_INPUT_ID,
	VOID_REASON_INPUT_ID,
} from '../lib/market-custom-id'
import { formatMarketPoints } from '../lib/market-embed'
import { hasMarketPermission } from '../lib/market-permissions'
import {
	announceMarketClosed,
	announceMarketResolved,
	dmWagerResults,
} from './discord-market-notify.service'
import {
	announceBetPlaced,
	applyMarketPostStatus,
	updateMarketPostFromDetail,
} from './discord-market-post.service'

import type { Discord, DiscordEmbed } from '@repo/discord'
import type { PredictionMarkets } from '@repo/prediction-markets'
import type { Env } from '../context'
import type { createDb } from '../db'

const EPHEMERAL_FLAG = 1 << 6
const NOT_LINKED = 'Your Discord account is not linked to a core user. Link it in the app first.'
const RESOLVER_ONLY = 'Resolver only — you don’t have permission for this action.'

/** Bindings the component/modal path needs (money DO, Discord DO, groups for the tier gate). */
export type ComponentEnv = Pick<
	Env,
	'DISCORD' | 'PREDICTION_MARKETS' | 'GROUPS' | 'PM_FORUM_GUILD_ID'
>

export interface DiscordComponentResult {
	response: { type: number; data: { content: string; flags?: number; embeds?: DiscordEmbed[] } }
	coreUserId: string | null
	reason: string
	/**
	 * Optional out-of-band work to run AFTER the user's confirmation is delivered — the RPC layer
	 * (executeDiscord* in index.ts) runs it in `ctx.waitUntil`. Used for the settlement DM fan-out,
	 * which is too slow (one rate-limited DM per participant) to block the resolver's confirmation.
	 * Never serialized to the interactions worker; consumed in-process by the RPC method.
	 */
	background?: () => Promise<void>
}

export interface ExecuteComponentInput {
	customId: string
	discordUserId: string
	/** The interaction id (bet idempotency key for the modal-submit path). */
	interactionId?: string | null
	guildId?: string | null
	channelId?: string | null
}

export interface ExecuteModalSubmitInput extends ExecuteComponentInput {
	/** Modal text-input values keyed by their custom_id. */
	fields: Record<string, string>
}

const ERROR_MESSAGES: Record<string, string> = {
	// bet
	MARKET_NOT_FOUND: 'That market no longer exists.',
	MARKET_NOT_OPEN: 'This market is not open for betting.',
	MARKET_CLOSED: 'Betting has closed on this market.',
	OUTCOME_NOT_FOUND: 'That outcome is no longer available.',
	STAKE_BELOW_MIN: 'Your stake is below the minimum for this market.',
	STAKE_ABOVE_MAX: 'Your stake is above the maximum for this market.',
	PER_USER_CAP_EXCEEDED: 'That would exceed your per-user cap on this market.',
	INSUFFICIENT_FUNDS: 'Not enough points — ask an admin for a grant, or lower your stake.',
	INVALID_AMOUNT: 'Enter a whole number of points.',
	// resolver
	MARKET_NOT_CLOSED: 'The market must be closed before it can be resolved.',
	MARKET_NOT_RESOLVING: 'There is no pending resolution to approve.',
	MARKET_TERMINAL: 'This market is already resolved or voided.',
	CREATOR_CANNOT_RESOLVE: 'You created this market, so you can’t resolve it.',
	RESOLVER_HAS_POSITION: 'You bet on this market, so you can’t resolve it.',
	APPROVER_MUST_DIFFER: 'A different resolver must approve this proposal.',
	PROPOSAL_NOT_FOUND: 'That proposal no longer exists.',
	PROPOSAL_NOT_PENDING: 'That proposal is no longer pending.',
	CONTESTED_VOID_REQUIRES_APPROVER:
		'This market has bets on multiple outcomes — a contested void needs a second approver (use the admin UI).',
	VOID_REASON_REQUIRED: 'A void reason is required.',
	NOT_DESIGNATED_RESOLVER: 'Only this market’s designated resolver(s) can settle it.',
}

function ephemeral(
	content: string,
	reason: string,
	coreUserId: string | null = null,
	background?: () => Promise<void>
): DiscordComponentResult {
	return {
		response: { type: 4, data: { content, flags: EPHEMERAL_FLAG } },
		coreUserId,
		reason,
		...(background ? { background } : {}),
	}
}

/** Pull the underlying driver error off a Drizzle "Failed query: …" wrapper (the real cause). */
function dbErrorCause(error: unknown): string | undefined {
	const cause = (error as { cause?: unknown } | null)?.cause
	if (cause == null) return undefined
	return cause instanceof Error ? cause.message : String(cause)
}

function mapError(
	error: unknown,
	coreUserId: string,
	ctx: { action: string; marketId?: string }
): DiscordComponentResult {
	const msg = error instanceof Error ? error.message : String(error)
	if (msg.startsWith('RATE_LIMITED')) {
		const ms = Number(msg.split(':')[1]) || 0
		return ephemeral(
			`Slow down — try again in ${Math.max(1, Math.ceil(ms / 1000))}s.`,
			'rate-limited',
			coreUserId
		)
	}
	const friendly = ERROR_MESSAGES[msg]
	if (friendly) return ephemeral(friendly, 'domain-error', coreUserId)
	// closeMarket guards state via assertTransition (a raw "invalid market transition" string),
	// not a coded status error — surface a stale-state message rather than the generic one.
	if (msg.startsWith('prediction-markets: invalid market transition')) {
		return ephemeral(
			'This market can’t be changed in its current state.',
			'stale-state',
			coreUserId
		)
	}
	// Anything else is unexpected — an infra failure (failed query, missing migration, Neon outage)
	// or an RPC error from the money DO. This is the branch that previously logged only a bare
	// message and left us guessing: log the full context + underlying driver cause + stack, and
	// page Sentry, so the next occurrence is diagnosable at a glance.
	const cause = dbErrorCause(error)
	logger.error('[DiscordComponents] action failed', {
		action: ctx.action,
		marketId: ctx.marketId,
		coreUserId,
		error: msg,
		errorName: error instanceof Error ? error.name : undefined,
		cause,
		stack: error instanceof Error ? error.stack : undefined,
	})
	captureException(error as Error, {
		tags: {
			service: 'discord-components',
			action: ctx.action,
			marketId: ctx.marketId ?? '',
			coreUserId,
		},
		extra: { cause },
	})
	return ephemeral('Could not complete this action. Please try again later.', 'error', coreUserId)
}

async function resolveUser(
	db: ReturnType<typeof createDb>,
	discordUserId: string
): Promise<{ id: string; is_admin: boolean } | null> {
	const user = await db.query.users.findFirst({
		where: eq(users.discordUserId, discordUserId),
		columns: { id: true, is_admin: true },
	})
	return user ?? null
}

/** Refresh the public post after a state change: embed + status buttons + tag + lock-on-terminal. */
async function refreshPost(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	prediction: PredictionMarkets,
	marketId: string
): Promise<void> {
	try {
		const market = await prediction.getMarket(marketId)
		if (!market) return
		const discord = getStub<Discord>(env.DISCORD, 'default')
		const edit = await updateMarketPostFromDetail(discord, market)
		// Only flip the tag / archive+lock if the message edit (which strips buttons on a
		// terminal market) actually landed — otherwise we'd lock a post with stale buttons.
		if (env.PM_FORUM_GUILD_ID && edit.success) {
			await applyMarketPostStatus(db, discord, env.PM_FORUM_GUILD_ID, market)
		}
	} catch (err) {
		logger.warn('[DiscordComponents] post refresh failed', {
			marketId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/** Post the "betting closed" notice to a market's thread. Best-effort — never fails the close. */
async function notifyClose(
	env: ComponentEnv,
	prediction: PredictionMarkets,
	marketId: string
): Promise<void> {
	try {
		const market = await prediction.getMarket(marketId)
		if (!market) return
		const discord = getStub<Discord>(env.DISCORD, 'default')
		await announceMarketClosed(discord, env.PM_FORUM_GUILD_ID ?? '', market)
	} catch (err) {
		logger.warn('[DiscordComponents] close notify failed', {
			marketId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/**
 * Announce a just-settled (resolved/voided) market to its thread NOW (fast, one message) and
 * return a thunk that DMs each participant their result. The DM fan-out is returned — not awaited —
 * so the caller runs it in the RPC's `ctx.waitUntil`, off the resolver's confirmation path (one
 * rate-limited DM per participant would otherwise make a large market's confirmation hang or time
 * out). Best-effort; returns undefined when there's nothing to notify. The resolution already
 * committed, so a Discord failure here is never fatal.
 */
async function announceSettlement(
	env: ComponentEnv,
	prediction: PredictionMarkets,
	marketId: string
): Promise<(() => Promise<void>) | undefined> {
	try {
		const market = await prediction.getMarket(marketId)
		if (!market) return undefined
		const settlement = await prediction.getMarketSettlement(marketId)
		if (!settlement) return undefined
		const discord = getStub<Discord>(env.DISCORD, 'default')
		await announceMarketResolved(discord, env.PM_FORUM_GUILD_ID ?? '', market, settlement)
		return () => dmWagerResults(discord, market, settlement)
	} catch (err) {
		logger.warn('[DiscordComponents] settlement announce failed', {
			marketId,
			error: err instanceof Error ? err.message : String(err),
		})
		return undefined
	}
}

async function requireResolver(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	discordUserId: string
): Promise<{ id: string; is_admin: boolean } | DiscordComponentResult> {
	const user = await resolveUser(db, discordUserId)
	if (!user) return ephemeral(NOT_LINKED, 'not-linked')
	if (!(await hasMarketPermission(env, user.id, 'resolver', user.is_admin))) {
		return ephemeral(RESOLVER_ONLY, 'forbidden', user.id)
	}
	return user
}

function isResult(x: { id: string } | DiscordComponentResult): x is DiscordComponentResult {
	return 'response' in x
}

/**
 * Whether this settler may bypass a market's designated-resolver set. Admins and `urn:markets:manager`
 * holders keep their "resolve any market" authority; a plain `urn:markets:resolver` does not. This
 * bypasses ONLY the per-market membership check — every conflict-of-interest guard still binds them.
 * Derive it solely from the tier check, never a literal (the DO trusts this flag unverified).
 */
async function canBypassDesignated(
	env: ComponentEnv,
	user: { id: string; is_admin: boolean }
): Promise<boolean> {
	return user.is_admin || (await hasMarketPermission(env, user.id, 'manager', user.is_admin))
}

// ---------------------------------------------------------------------------
// Buttons (no modal): Close, Approve — resolver-gated
// ---------------------------------------------------------------------------

export async function executeDiscordComponent(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	input: ExecuteComponentInput
): Promise<DiscordComponentResult> {
	const decoded = decodeMarketAction(input.customId)
	if (!decoded || (decoded.action !== 'close' && decoded.action !== 'approve')) {
		return ephemeral('This action is not available.', 'invalid-component')
	}

	const auth = await requireResolver(db, env, input.discordUserId)
	if (isResult(auth)) return auth
	const user = auth

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	try {
		if (decoded.action === 'close') {
			await prediction.closeMarket({ actorUserId: user.id, marketId: decoded.marketId })
			await refreshPost(db, env, prediction, decoded.marketId)
			await notifyClose(env, prediction, decoded.marketId)
			return ephemeral('Market closed.', 'ok', user.id)
		}
		// approve
		const proposal = await prediction.getPendingProposal(decoded.marketId)
		if (!proposal) return ephemeral('No pending resolution to approve.', 'no-proposal', user.id)
		const result = await prediction.approveResolution({
			resolverId: user.id,
			marketId: decoded.marketId,
			proposalId: proposal.id,
			bypassDesignated: await canBypassDesignated(env, user),
		})
		await refreshPost(db, env, prediction, decoded.marketId)
		let background: (() => Promise<void>) | undefined
		if (result.status === 'resolved' || result.status === 'voided') {
			background = await announceSettlement(env, prediction, decoded.marketId)
		}
		return ephemeral(
			result.status === 'voided' ? 'Resolution approved — market voided.' : 'Resolution approved.',
			'ok',
			user.id,
			background
		)
	} catch (error) {
		return mapError(error, user.id, { action: decoded.action, marketId: decoded.marketId })
	}
}

// ---------------------------------------------------------------------------
// Modal submits: betmodal (member), resolvemodal / voidmodal (resolver)
// ---------------------------------------------------------------------------

export async function executeDiscordModalSubmit(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	input: ExecuteModalSubmitInput
): Promise<DiscordComponentResult> {
	switch (customIdAction(input.customId)) {
		case 'betmodal':
			return handleBetModal(db, env, input)
		case 'resolvemodal':
			return handleResolveModal(db, env, input)
		case 'voidmodal':
			return handleVoidModal(db, env, input)
		default:
			return ephemeral('Unsupported modal.', 'invalid-component')
	}
}

async function handleBetModal(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	input: ExecuteModalSubmitInput
): Promise<DiscordComponentResult> {
	const target = decodeBetTarget(input.customId)
	if (!target) return ephemeral('Could not read this bet. Please try again.', 'invalid-component')
	if (!input.interactionId) {
		// Real interactions always carry an id; guard so a bet is never placed without a key.
		return ephemeral('Could not process this bet. Please try again.', 'invalid-component')
	}

	const user = await resolveUser(db, input.discordUserId)
	if (!user) return ephemeral(NOT_LINKED, 'not-linked')

	const amountRaw = (input.fields[BET_AMOUNT_INPUT_ID] ?? '').trim()
	if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) {
		return ephemeral('Enter a whole number of points greater than zero.', 'invalid-amount', user.id)
	}

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	// Breadcrumb before the money DO call — pairs with the '[DiscordComponents] action failed' /
	// PM DO 'placeBet failed' logs (correlate on interactionId) so a failure shows exactly how far
	// the bet got and what the inputs were.
	logger.info('[DiscordComponents] placing bet', {
		interactionId: input.interactionId,
		marketId: target.marketId,
		outcomeId: target.outcomeId,
		userId: user.id,
		amount: amountRaw,
	})
	try {
		const bet = await prediction.placeBet({
			userId: user.id,
			marketId: target.marketId,
			outcomeId: target.outcomeId,
			amount: amountRaw,
			idempotencyKey: input.interactionId,
		})
		logger.info('[DiscordComponents] bet placed', {
			interactionId: input.interactionId,
			marketId: target.marketId,
			betId: bet.id,
			userId: user.id,
			amount: bet.amount,
		})
		let outcomeLabel = ''
		try {
			const market = await prediction.getMarket(target.marketId)
			if (market) {
				outcomeLabel = market.outcomes.find((o) => o.id === target.outcomeId)?.label ?? ''
				const discord = getStub<Discord>(env.DISCORD, 'default')
				await updateMarketPostFromDetail(discord, market)
				// Announce the bet publicly in the market's forum thread — who bet, how much, on which
				// outcome. Best-effort (sibling to the embed refresh above). Skip on a deduped
				// (duplicate-delivery) bet so a retried interaction can't post twice. `<@id>` renders
				// the bettor's name without pinging (allowed_mentions stays empty).
				if (!bet.deduped) {
					await announceBetPlaced(
						discord,
						env.PM_FORUM_GUILD_ID ?? '',
						market,
						`<@${input.discordUserId}>`,
						bet.amount,
						outcomeLabel
					)
				}
			}
		} catch (err) {
			logger.warn('[DiscordComponents] post refresh after bet failed', {
				marketId: target.marketId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
		const on = outcomeLabel ? ` on **${outcomeLabel}**` : ''
		return ephemeral(`Bet placed: ${formatMarketPoints(bet.amount)}${on}.`, 'ok', user.id)
	} catch (error) {
		return mapError(error, user.id, { action: 'bet', marketId: target.marketId })
	}
}

async function handleResolveModal(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	input: ExecuteModalSubmitInput
): Promise<DiscordComponentResult> {
	const marketId = decodeSingleMarketId(input.customId, 'resolvemodal')
	if (!marketId) return ephemeral('Could not read this action.', 'invalid-component')

	const auth = await requireResolver(db, env, input.discordUserId)
	if (isResult(auth)) return auth
	const user = auth

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	const market = await prediction.getMarket(marketId)
	if (!market) return ephemeral('That market no longer exists.', 'not-found', user.id)

	const raw = (input.fields[RESOLVE_OUTCOME_INPUT_ID] ?? '').trim()
	const idx = Number(raw)
	if (!/^\d+$/.test(raw) || idx < 1 || idx > market.outcomes.length) {
		return ephemeral(
			`Enter a valid outcome number (1–${market.outcomes.length}).`,
			'invalid-outcome',
			user.id
		)
	}
	const outcome = market.outcomes[idx - 1]

	try {
		const result = await prediction.proposeResolution({
			resolverId: user.id,
			marketId,
			outcomeId: outcome.id,
			bypassDesignated: await canBypassDesignated(env, user),
		})
		await refreshPost(db, env, prediction, marketId)
		let background: (() => Promise<void>) | undefined
		if (result.status === 'resolved' || result.status === 'voided') {
			background = await announceSettlement(env, prediction, marketId)
		}
		if (result.status === 'resolved') {
			return ephemeral(`Market resolved: **${outcome.label}**.`, 'ok', user.id, background)
		}
		if (result.status === 'voided') {
			return ephemeral(
				'Market resolved with no winning bets — everyone refunded.',
				'ok',
				user.id,
				background
			)
		}
		// resolving (two-of-N): a second resolver must approve.
		return ephemeral(
			`Resolution proposed: **${outcome.label}**. A second resolver must approve.`,
			'ok',
			user.id
		)
	} catch (error) {
		return mapError(error, user.id, { action: 'resolve', marketId })
	}
}

async function handleVoidModal(
	db: ReturnType<typeof createDb>,
	env: ComponentEnv,
	input: ExecuteModalSubmitInput
): Promise<DiscordComponentResult> {
	const marketId = decodeSingleMarketId(input.customId, 'voidmodal')
	if (!marketId) return ephemeral('Could not read this action.', 'invalid-component')

	const auth = await requireResolver(db, env, input.discordUserId)
	if (isResult(auth)) return auth
	const user = auth

	const reason = (input.fields[VOID_REASON_INPUT_ID] ?? '').trim()
	if (reason.length < 3) {
		return ephemeral('Enter a void reason (at least 3 characters).', 'invalid-reason', user.id)
	}

	const prediction = getStub<PredictionMarkets>(env.PREDICTION_MARKETS, 'default')
	try {
		await prediction.voidMarket({
			actorUserId: user.id,
			marketId,
			reason,
			bypassDesignated: await canBypassDesignated(env, user),
		})
		await refreshPost(db, env, prediction, marketId)
		const background = await announceSettlement(env, prediction, marketId)
		return ephemeral('Market voided and all bets refunded.', 'ok', user.id, background)
	} catch (error) {
		return mapError(error, user.id, { action: 'void', marketId })
	}
}
