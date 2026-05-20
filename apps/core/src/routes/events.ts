/**
 * Events routes - read-only view of upcoming Discord scheduled events.
 *
 * Discord is the source of truth for events: they are created, edited, and
 * cancelled in the Discord client. Auth reads the main guild's upcoming
 * events for the dashboard and resolves each creator's Discord ID to their
 * EVE main character name (the name the community actually recognizes).
 */

import { Hono } from 'hono'

import { inArray } from '@repo/db-utils'
import { getDiscordStub } from '@repo/discord'
import { TimeCache, logger } from '@repo/hono-helpers'

import { userCharacters, users } from '../db/schema'
import { requireAuth } from '../middleware/session'

import type { DiscordGuildScheduledEvent } from '@repo/discord'
import type { Context } from 'hono'
import type { App } from '../context'

/** Discord scheduled-event status: 1 SCHEDULED, 2 ACTIVE, 3 COMPLETED, 4 CANCELED. */
const STATUS_ACTIVE = 2

/** An upcoming event with its creator resolved to an EVE main character name. */
type EnrichedEvent = DiscordGuildScheduledEvent & {
	/** Creator's EVE main character name, or null when it cannot be resolved. */
	creatorMainCharacter: string | null
}

/**
 * Shared cache of the guild's scheduled events (keyed by guild ID), 60s TTL.
 *
 * The event list is identical for every user, so caching here collapses
 * many concurrent browser polls into one Discord API call per minute —
 * keeping us well clear of Discord's per-route rate limits as usage grows.
 */
const eventsCache = new TimeCache<DiscordGuildScheduledEvent[]>(60_000)

const app = new Hono<App>()

/**
 * Fetch and sort the main guild's scheduled events (soonest first).
 * Cached for 60s and shared across all callers. Returns an empty list
 * when no guild is configured.
 */
async function fetchGuildEvents(c: Context<App>) {
	const guildId = c.env.MAIN_DISCORD_GUILD_ID
	if (!guildId) {
		logger.warn('MAIN_DISCORD_GUILD_ID is not configured; returning no events')
		return []
	}

	return eventsCache.getOrSet(guildId, async () => {
		const discord = getDiscordStub(c.env)
		const events = await discord.listGuildScheduledEvents(guildId)
		return [...events].sort(
			(a, b) =>
				new Date(a.scheduledStartTime).getTime() - new Date(b.scheduledStartTime).getTime()
		)
	})
}

/**
 * Resolve event creators' Discord user IDs to EVE main character names.
 *
 * Builds a map from Discord user ID -> main character name by joining the
 * users table (linked via discord_user_id) to user_characters. Creators who
 * have not linked their Discord account simply resolve to null.
 */
async function resolveCreatorCharacters(
	c: Context<App>,
	events: DiscordGuildScheduledEvent[]
): Promise<Map<string, string>> {
	const discordUserIds = [
		...new Set(
			events
				.map((event) => event.creator?.id)
				.filter((id): id is string => typeof id === 'string' && id.length > 0)
		),
	]
	if (discordUserIds.length === 0) {
		return new Map()
	}

	const db = c.get('db')
	if (!db) {
		return new Map()
	}

	try {
		// users -> the linked auth account; user_characters -> the main char name.
		const matchedUsers = await db.query.users.findMany({
			where: inArray(users.discordUserId, discordUserIds),
			columns: { discordUserId: true, mainCharacterId: true },
		})

		const mainCharacterIds = matchedUsers
			.map((user) => user.mainCharacterId)
			.filter((id): id is string => !!id)
		if (mainCharacterIds.length === 0) {
			return new Map()
		}

		const characters = await db.query.userCharacters.findMany({
			where: inArray(userCharacters.characterId, mainCharacterIds),
			columns: { characterId: true, characterName: true },
		})
		const nameByCharacterId = new Map(
			characters.map((char) => [char.characterId, char.characterName])
		)

		const result = new Map<string, string>()
		for (const user of matchedUsers) {
			if (!user.discordUserId || !user.mainCharacterId) continue
			const name = nameByCharacterId.get(user.mainCharacterId)
			if (name) result.set(user.discordUserId, name)
		}
		return result
	} catch (error) {
		// Resolution is best-effort — never fail the request over it.
		logger.warn('Failed to resolve event creator characters:', {
			error: error instanceof Error ? error.message : String(error),
		})
		return new Map()
	}
}

/**
 * GET /events/upcoming
 * Upcoming (not-yet-finished, non-cancelled) scheduled events, with each
 * creator resolved to their EVE main character name. Powers the dashboard.
 */
app.get('/upcoming', requireAuth(), async (c) => {
	try {
		const events = await fetchGuildEvents(c)
		const now = Date.now()
		const upcoming = events.filter((event: DiscordGuildScheduledEvent) => {
			if (event.status > STATUS_ACTIVE) return false // completed or canceled
			// Keep events whose end (or start, if no end) is still in the future.
			const end = event.scheduledEndTime ?? event.scheduledStartTime
			return new Date(end).getTime() >= now
		})

		const creatorNames = await resolveCreatorCharacters(c, upcoming)
		const enriched: EnrichedEvent[] = upcoming.map((event) => ({
			...event,
			creatorMainCharacter: event.creator
				? (creatorNames.get(event.creator.id) ?? null)
				: null,
		}))

		return c.json(enriched)
	} catch (error) {
		logger.error('Error listing upcoming Discord scheduled events:', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to load upcoming events' }, 500)
	}
})

export default app
