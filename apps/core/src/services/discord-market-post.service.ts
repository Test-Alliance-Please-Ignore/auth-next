/**
 * Prediction-markets → Discord forum-post orchestration.
 *
 * Core is the sole orchestrator: it reads market state from the PM DO, renders the
 * embed, and drives the Discord DO to create/update the forum post. The PM DO never
 * calls Discord — Core writes the post mapping back via `attachDiscordPost`.
 */

import { eq } from '@repo/db-utils'

import { pmForumConfig } from '../db/schema'
import { buildMarketComponents } from '../lib/market-components'
import { buildBetAnnouncement, buildMarketEmbed, truncateForEmbed } from '../lib/market-embed'

import type { createDb } from '../db'
import type { Discord, SendMessageResult } from '@repo/discord'
import type { MarketDetail, PredictionMarkets } from '@repo/prediction-markets'

type CoreDb = ReturnType<typeof createDb>
type ForumConfigRow = typeof pmForumConfig.$inferSelect

const FORUM_CHANNEL_NAME = 'prediction-markets'
const STATUS_TAG_NAMES = ['Open', 'Closed', 'Resolved', 'Voided'] as const

export interface ForumConfig {
	guildId: string
	categoryId: string
	forumChannelId: string
	tagOpenId: string | null
	tagClosedId: string | null
	tagResolvedId: string | null
	tagVoidedId: string | null
}

/** Thrown while a concurrent caller is still creating the forum channel (retryable). */
export class ForumInitInProgressError extends Error {
	constructor() {
		super('FORUM_CHANNEL_INIT_IN_PROGRESS')
		this.name = 'ForumInitInProgressError'
	}
}

function toForumConfig(row: ForumConfigRow): ForumConfig {
	return {
		guildId: row.guildId,
		categoryId: row.categoryId,
		forumChannelId: row.forumChannelId ?? '',
		tagOpenId: row.tagOpenId,
		tagClosedId: row.tagClosedId,
		tagResolvedId: row.tagResolvedId,
		tagVoidedId: row.tagVoidedId,
	}
}

/**
 * Ensure the markets forum channel exists under the configured category with inherited
 * (synced) permissions + the four status tags. Bootstrap is serialized by a claim row
 * (`guildId` PK + ON CONFLICT DO NOTHING) so a concurrent first-create can't spawn two
 * channels: only the insert winner calls Discord; losers read the winner's row.
 */
export async function ensureForumChannel(
	db: CoreDb,
	discord: Discord,
	guildId: string,
	categoryId: string
): Promise<ForumConfig> {
	const [existing] = await db
		.select()
		.from(pmForumConfig)
		.where(eq(pmForumConfig.guildId, guildId))
		.limit(1)
	if (existing?.forumChannelId) return toForumConfig(existing)

	// Claim the guild row; only the insert winner proceeds to create the Discord channel.
	const claimed = await db
		.insert(pmForumConfig)
		.values({ guildId, categoryId })
		.onConflictDoNothing()
		.returning({ guildId: pmForumConfig.guildId })

	if (claimed.length === 0) {
		// A concurrent caller owns the claim; use its result if the channel already exists.
		const [row] = await db
			.select()
			.from(pmForumConfig)
			.where(eq(pmForumConfig.guildId, guildId))
			.limit(1)
		if (row?.forumChannelId) return toForumConfig(row)
		throw new ForumInitInProgressError()
	}

	// We own the claim → create the forum channel under the category with the category's
	// permission overwrites (copied verbatim = Discord "synced/inherited" perms) + status tags.
	const category = await discord.getChannel(categoryId)
	const created = await discord.createForumChannel(guildId, {
		name: FORUM_CHANNEL_NAME,
		parentId: categoryId,
		...(category.permission_overwrites
			? { permissionOverwrites: category.permission_overwrites }
			: {}),
		availableTags: STATUS_TAG_NAMES.map((name) => ({ name, moderated: true })),
	})
	const tagId = (name: string): string | null =>
		created.available_tags?.find((t) => t.name === name)?.id ?? null

	const [row] = await db
		.update(pmForumConfig)
		.set({
			forumChannelId: created.id,
			tagOpenId: tagId('Open'),
			tagClosedId: tagId('Closed'),
			tagResolvedId: tagId('Resolved'),
			tagVoidedId: tagId('Voided'),
			updatedAt: new Date(),
		})
		.where(eq(pmForumConfig.guildId, guildId))
		.returning()
	return toForumConfig(row)
}

/**
 * Ensure the forum channel, post the market thread, and persist the mapping back to the
 * PM DO. Best-effort: the caller surfaces a thrown error as `postError` (the market
 * already exists, so a Discord failure is recoverable, never a lost market).
 */
export async function publishMarketPost(
	db: CoreDb,
	discord: Discord,
	prediction: PredictionMarkets,
	guildId: string,
	categoryId: string,
	market: MarketDetail
): Promise<{ threadId: string; messageId: string }> {
	const cfg = await ensureForumChannel(db, discord, guildId, categoryId)
	if (!cfg.forumChannelId) throw new ForumInitInProgressError()

	// Tag by the market's actual status, not a hardcoded "Open": a reconcile backfill can publish a
	// market that has already auto-closed, which must land under the Closed tag, not Open.
	const tagId = statusTagId(cfg, market.status)
	const post = await discord.createMarketForumPost(cfg.forumChannelId, {
		// Forum thread name max is 100 chars; the full question lives in the embed title.
		name: truncateForEmbed(market.question, 100),
		embeds: [buildMarketEmbed(market)],
		components: buildMarketComponents(market),
		...(tagId ? { appliedTagIds: [tagId] } : {}),
	})
	await prediction.attachDiscordPost({
		marketId: market.id,
		threadId: post.threadId,
		messageId: post.messageId,
	})
	return post
}

/**
 * Refresh a market's forum post — embed + status-appropriate buttons (bet buttons on open
 * markets; resolver controls per status; none when terminal). Editing the message must happen
 * before any archive (see applyMarketPostStatus). No-op if the market has no post yet.
 */
export async function updateMarketPostFromDetail(
	discord: Discord,
	market: MarketDetail
): Promise<{ success: boolean; error?: string }> {
	if (!market.discordThreadId || !market.discordMessageId) {
		return { success: false, error: 'no post' }
	}
	return discord.updateMarketPostMessage(market.discordThreadId, market.discordMessageId, {
		embeds: [buildMarketEmbed(market)],
		components: buildMarketComponents(market),
	})
}

/**
 * Post an anonymized "bet placed" announcement into a market's forum thread — the amount and
 * chosen outcome only, never who placed it. Sent as a regular thread message (a thread is a
 * channel), reusing sendMessage's rate-limit retry; mentions are suppressed so a user-authored
 * outcome label can't ping anyone. Best-effort: no-op if the market has no post yet, and the
 * returned {success,error} is for logging only — a failed announcement must never fail the bet.
 * `guildId` is used only for the DO's log context (sendMessage POSTs by channel/thread id).
 */
export async function announceBetPlaced(
	discord: Discord,
	guildId: string,
	market: MarketDetail,
	amount: string,
	outcomeLabel: string
): Promise<SendMessageResult> {
	if (!market.discordThreadId) return { success: false, error: 'no post' }
	if (!outcomeLabel) return { success: false, error: 'no outcome' }
	return discord.sendMessage(guildId, market.discordThreadId, {
		content: buildBetAnnouncement(amount, outcomeLabel),
		allowEveryone: false,
	})
}

/** The status → forum-tag-id for a market's current status (null if unmapped/unconfigured). */
function statusTagId(cfg: ForumConfig, status: MarketDetail['status']): string | null {
	switch (status) {
		case 'open':
			return cfg.tagOpenId
		case 'closed':
		case 'resolving':
			return cfg.tagClosedId
		case 'resolved':
			return cfg.tagResolvedId
		case 'voided':
			return cfg.tagVoidedId
		default:
			return null
	}
}

/**
 * Apply the forum-thread status side of a transition: flip the status tag and, on a terminal
 * status (resolved/voided), archive + lock — combined into one PATCH (an archived thread would
 * otherwise need to be unarchived first). Call AFTER updateMarketPostFromDetail so the message
 * edit lands before the archive. Best-effort; no-op if the market has no post.
 */
export async function applyMarketPostStatus(
	db: CoreDb,
	discord: Discord,
	guildId: string,
	market: MarketDetail
): Promise<void> {
	if (!market.discordThreadId) return
	const [cfg] = await db
		.select()
		.from(pmForumConfig)
		.where(eq(pmForumConfig.guildId, guildId))
		.limit(1)
	const tagId = cfg ? statusTagId(toForumConfig(cfg), market.status) : null
	const terminal = market.status === 'resolved' || market.status === 'voided'
	if (!tagId && !terminal) return
	await discord.lockThread(market.discordThreadId, {
		...(tagId ? { appliedTagIds: [tagId] } : {}),
		...(terminal ? { archived: true, locked: true } : {}),
	})
}
