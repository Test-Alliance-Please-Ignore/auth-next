// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	useAssignTimerboardEntry,
	useCreateTimerboardEntry,
	useSetTimerboardState,
	useTimerboard,
	useTimerboardActivity,
	useTimerboardEntry,
	useUpdateTimerboardEntry,
} from '@/features/timerboard/hooks'
import { timerboardKeys } from '@/features/timerboard/query-keys'
import { ConflictError } from '@/lib/api'

import type { PropsWithChildren } from 'react'
import type { TimerboardEntry } from '@/features/timerboard/types'
import type * as ApiModule from '@/lib/api'

const apiMocks = vi.hoisted(() => ({
	assign: vi.fn(),
	create: vi.fn(),
	getActivity: vi.fn(),
	getEntry: vi.fn(),
	getEntries: vi.fn(),
	setState: vi.fn(),
	update: vi.fn(),
}))

vi.mock('@/lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof ApiModule>()
	return {
		...actual,
		api: {
			assignTimerboardEntry: apiMocks.assign,
			createTimerboardEntry: apiMocks.create,
			getTimerboardActivity: apiMocks.getActivity,
			getTimerboardEntry: apiMocks.getEntry,
			getTimerboardEntries: apiMocks.getEntries,
			setTimerboardEntryState: apiMocks.setState,
			updateTimerboardEntry: apiMocks.update,
		},
	}
})

const oldEntry: TimerboardEntry = {
	id: '22222222-2222-4222-8222-222222222222',
	category: 'fleet',
	timerType: 'custom',
	title: 'Old timer',
	priority: 'high',
	hostility: 'friendly',
	startsAt: '2026-09-01T20:00:00.000Z',
	state: 'planned',
	systemId: null,
	systemName: '1DQ1-A',
	regionId: null,
	regionName: null,
	corporationId: null,
	corporationName: null,
	allianceId: null,
	allianceName: null,
	subjectId: null,
	subjectType: null,
	subjectName: null,
	assignedUserId: null,
	assignedCharacterId: null,
	assignedCharacterName: null,
	notes: null,
	sourceKind: 'manual',
	sourceReference: null,
	createdByUserId: '11111111-1111-4111-8111-111111111111',
	updatedByUserId: '11111111-1111-4111-8111-111111111111',
	version: 1,
	createdAt: '2026-08-30T19:00:00.000Z',
	updatedAt: '2026-08-30T19:00:00.000Z',
	isOverdue: false,
	actions: {
		canEdit: true,
		canAssign: true,
		canSetCovered: true,
		canComplete: true,
		canCancel: true,
	},
}

function createHarness() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	})
	const wrapper = ({ children }: PropsWithChildren) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
	return { queryClient, wrapper }
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('Timerboard mutation hooks', () => {
	it('refreshes list, detail, and activity queries on window focus', () => {
		apiMocks.getEntries.mockResolvedValue({ items: [], page: 1, pageSize: 25, total: 0 })
		apiMocks.getEntry.mockResolvedValue(oldEntry)
		apiMocks.getActivity.mockResolvedValue([])
		const { queryClient, wrapper } = createHarness()

		renderHook(
			() => ({
				list: useTimerboard({ page: 1 }),
				detail: useTimerboardEntry(oldEntry.id),
				activity: useTimerboardActivity(oldEntry.id),
			}),
			{ wrapper }
		)

		for (const queryKey of [
			timerboardKeys.list({ page: 1 }),
			timerboardKeys.detail(oldEntry.id),
			timerboardKeys.activity(oldEntry.id),
		]) {
			const query = queryClient.getQueryCache().find({ queryKey })
			expect((query?.options as { refetchOnWindowFocus?: boolean }).refetchOnWindowFocus).toBe(true)
		}
	})

	it('seeds detail reads from an already-cached list without another request', async () => {
		apiMocks.getEntry.mockResolvedValue(oldEntry)
		const { queryClient, wrapper } = createHarness()
		queryClient.setQueryData(timerboardKeys.list({ page: 1 }), {
			items: [oldEntry],
			page: 1,
			pageSize: 25,
			total: 1,
		})

		const { result } = renderHook(() => useTimerboardEntry(oldEntry.id), { wrapper })

		await waitFor(() => expect(result.current.data).toEqual(oldEntry))
		expect(apiMocks.getEntry).not.toHaveBeenCalled()
	})

	it('loads the current server entry into the detail cache after a state conflict', async () => {
		const current = { ...oldEntry, title: 'Current timer', state: 'covered' as const, version: 2 }
		apiMocks.setState.mockRejectedValue(new ConflictError('Timer changed', current))
		const { queryClient, wrapper } = createHarness()
		queryClient.setQueryData(timerboardKeys.detail(oldEntry.id), oldEntry)
		const { result } = renderHook(() => useSetTimerboardState(), { wrapper })

		await act(async () => {
			await result.current
				.mutateAsync({ entryId: oldEntry.id, state: 'completed', expectedVersion: 1 })
				.catch(() => undefined)
		})

		await waitFor(() => {
			expect(queryClient.getQueryData(timerboardKeys.detail(oldEntry.id))).toEqual(current)
		})
	})

	it('loads the current server entry into the detail cache after an assignment conflict', async () => {
		const current = { ...oldEntry, title: 'Reassigned timer', version: 3 }
		apiMocks.assign.mockRejectedValue(new ConflictError('Timer changed', current))
		const { queryClient, wrapper } = createHarness()
		queryClient.setQueryData(timerboardKeys.detail(oldEntry.id), oldEntry)
		const { result } = renderHook(() => useAssignTimerboardEntry(), { wrapper })

		await act(async () => {
			await result.current
				.mutateAsync({
					entryId: oldEntry.id,
					input: {
						userId: null,
						characterId: null,
						characterName: null,
						expectedVersion: 1,
					},
				})
				.catch(() => undefined)
		})

		await waitFor(() => {
			expect(queryClient.getQueryData(timerboardKeys.detail(oldEntry.id))).toEqual(current)
		})
	})

	it('invalidates list, detail, and activity caches after creation', async () => {
		apiMocks.create.mockResolvedValue(oldEntry)
		const { queryClient, wrapper } = createHarness()
		const listKey = timerboardKeys.list({ page: 1 })
		queryClient.setQueryData(listKey, { items: [], page: 1, pageSize: 25, total: 0 })
		queryClient.setQueryData(timerboardKeys.detail(oldEntry.id), oldEntry)
		queryClient.setQueryData(timerboardKeys.activity(oldEntry.id), [])
		const { result } = renderHook(() => useCreateTimerboardEntry(), { wrapper })

		await act(async () => {
			await result.current.mutateAsync({
				category: oldEntry.category,
				timerType: oldEntry.timerType,
				title: oldEntry.title,
				priority: oldEntry.priority,
				hostility: oldEntry.hostility,
				startsAt: oldEntry.startsAt,
				systemId: oldEntry.systemId,
				systemName: oldEntry.systemName,
				regionId: oldEntry.regionId,
				regionName: oldEntry.regionName,
				corporationId: oldEntry.corporationId,
				corporationName: oldEntry.corporationName,
				allianceId: oldEntry.allianceId,
				allianceName: oldEntry.allianceName,
				subjectId: oldEntry.subjectId,
				subjectType: oldEntry.subjectType,
				subjectName: oldEntry.subjectName,
				notes: oldEntry.notes,
			})
		})

		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
		expect(queryClient.getQueryState(timerboardKeys.detail(oldEntry.id))?.isInvalidated).toBe(true)
		expect(queryClient.getQueryState(timerboardKeys.activity(oldEntry.id))?.isInvalidated).toBe(
			true
		)
	})

	it('invalidates list, detail, and activity caches after update', async () => {
		const updated = { ...oldEntry, title: 'Updated timer', version: 2 }
		apiMocks.update.mockResolvedValue(updated)
		const { queryClient, wrapper } = createHarness()
		const listKey = timerboardKeys.list({ page: 1 })
		queryClient.setQueryData(listKey, { items: [oldEntry], page: 1, pageSize: 25, total: 1 })
		queryClient.setQueryData(timerboardKeys.detail(oldEntry.id), oldEntry)
		queryClient.setQueryData(timerboardKeys.activity(oldEntry.id), [])
		const { result } = renderHook(() => useUpdateTimerboardEntry(), { wrapper })

		await act(async () => {
			await result.current.mutateAsync({
				entryId: oldEntry.id,
				input: { title: 'Updated timer', expectedVersion: 1 },
			})
		})

		expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
		expect(queryClient.getQueryState(timerboardKeys.detail(oldEntry.id))?.isInvalidated).toBe(true)
		expect(queryClient.getQueryState(timerboardKeys.activity(oldEntry.id))?.isInvalidated).toBe(
			true
		)
	})
})
