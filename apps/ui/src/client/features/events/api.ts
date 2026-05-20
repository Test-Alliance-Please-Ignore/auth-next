import { apiClient } from '@/lib/api'

import type { DiscordScheduledEvent } from './types'

/**
 * List upcoming (not-yet-finished, non-cancelled) scheduled events from the
 * main Discord server, with each creator resolved to an EVE main character.
 */
export async function listUpcomingEvents(): Promise<DiscordScheduledEvent[]> {
	return apiClient.get('/events/upcoming')
}
