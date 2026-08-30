import type { TimerboardListQuery } from './types'

export const timerboardKeys = {
	all: ['timerboard'] as const,
	lists: () => [...timerboardKeys.all, 'list'] as const,
	list: (query: TimerboardListQuery) => [...timerboardKeys.lists(), query] as const,
	details: () => [...timerboardKeys.all, 'detail'] as const,
	detail: (entryId: string) => [...timerboardKeys.details(), entryId] as const,
	activity: (entryId: string) => [...timerboardKeys.detail(entryId), 'activity'] as const,
}
