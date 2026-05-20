/**
 * Client-side types for the Events feature.
 *
 * Events are owned by Discord — created and managed in the Discord client.
 * Auth reads the main guild's scheduled events for display only. These
 * shapes mirror what core's read-only /api/events endpoints return.
 */

/** Discord scheduled-event status codes. */
export const EVENT_STATUS = {
	SCHEDULED: 1,
	ACTIVE: 2,
	COMPLETED: 3,
	CANCELED: 4,
} as const

export interface DiscordEventCreator {
	id: string
	username: string
	displayName: string | null
}

export interface DiscordScheduledEvent {
	id: string
	guildId: string
	name: string
	description: string | null
	/** ISO-8601 start time. */
	scheduledStartTime: string
	/** ISO-8601 end time. Null for channel-based (VOICE/STAGE) events. */
	scheduledEndTime: string | null
	/** Free-text location for EXTERNAL events; null otherwise. */
	location: string | null
	/** 1 SCHEDULED, 2 ACTIVE, 3 COMPLETED, 4 CANCELED. */
	status: number
	/** Subscribed/interested user count, when available. */
	userCount: number | null
	/** Cover image URL, or null when the event has no image. */
	imageUrl: string | null
	/** Who created the event, when available (raw Discord identity). */
	creator: DiscordEventCreator | null
	/**
	 * The creator's EVE main character name, resolved by core from their
	 * linked auth account. Null when the creator has not linked Discord.
	 */
	creatorMainCharacter: string | null
}

/** Build the public Discord URL for an event (opens in the Discord client/web). */
export function discordEventUrl(event: Pick<DiscordScheduledEvent, 'guildId' | 'id'>): string {
	return `https://discord.com/events/${event.guildId}/${event.id}`
}
