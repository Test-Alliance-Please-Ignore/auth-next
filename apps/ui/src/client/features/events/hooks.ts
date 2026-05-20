import { useQuery } from '@tanstack/react-query'

import { listUpcomingEvents } from './api'
import { eventsKeys } from './query-keys'

/** Discord events change infrequently; poll modestly. */
const STALE_2M = 1000 * 60 * 2

/**
 * Upcoming (not-yet-finished) scheduled events from the main Discord server.
 */
export function useUpcomingEvents() {
	return useQuery({
		queryKey: eventsKeys.upcoming(),
		queryFn: () => listUpcomingEvents(),
		staleTime: STALE_2M,
	})
}
