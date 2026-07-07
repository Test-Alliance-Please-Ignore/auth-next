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
import { buildMarketEmbed, truncateForEmbed } from '../lib/market-embed'

import type { createDb } from '../db'
import type { Discord } from '@repo/discord'
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

	const post = await discord.createMarketForumPost(cfg.forumChannelId, {
		// Forum thread name max is 100 chars; the full question lives in the embed title.
		name: truncateForEmbed(market.question, 100),
		embeds: [buildMarketEmbed(market)],
		components: buildMarketComponents(market),
		...(cfg.tagOpenId ? { appliedTagIds: [cfg.tagOpenId] } : {}),
	})
	await prediction.attachDiscordPost({
		marketId: market.id,
		threadId: post.threadId,
		messageId: post.messageId,
	})
	return post
}

/**
 * Refresh a market's forum post embed in place after state changes (e.g. a new bet). Leaves
 * the bet buttons intact (components omitted). No-op if the market has no post yet.
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
	})
}
