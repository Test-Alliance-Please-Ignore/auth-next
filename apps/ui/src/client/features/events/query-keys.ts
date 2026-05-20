/**
 * React Query keys for the Events feature.
 */
export const eventsKeys = {
	all: ['events'] as const,
	upcoming: () => [...eventsKeys.all, 'upcoming'] as const,
}
