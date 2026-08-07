/**
 * Unit tests for useAddApplicationAlt and useRemoveApplicationAlt hooks.
 *
 * Tests the cache mutation logic (onMutate / onError / onSettled) directly
 * using a real QueryClient, without needing renderHook.
 */

import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { applicationKeys } from '../../client/features/applications/hooks'

import type {
	Application,
	ApplicationActivityLogEntry,
} from '../../client/features/applications/api'

// ============================================================================
// Helpers
// ============================================================================

function makeApplication(overrides: Partial<Application> = {}): Application {
	return {
		id: 'app-1',
		userId: 'user-1',
		corporationId: 'corp-1',
		corporationName: 'Test Corp',
		characterId: '1001',
		characterName: 'Main Pilot',
		applicationText: 'hello',
		status: 'pending',
		altCharacterIds: [],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	}
}

function makeActivityEntry(
	overrides: Partial<ApplicationActivityLogEntry> = {}
): ApplicationActivityLogEntry {
	return {
		id: 'log-1',
		applicationId: 'app-1',
		action: 'submitted',
		characterId: '1001',
		characterName: 'Main Pilot',
		previousValue: undefined,
		newValue: undefined,
		metadata: undefined,
		timestamp: new Date().toISOString(),
		...overrides,
	}
}

// Extract the mutation config from the hook by reconstructing it inline.
// This lets us test onMutate / onError / onSettled without React context.
function makeAddAltMutationHandlers(queryClient: QueryClient) {
	return {
		mutationFn: vi.fn(),
		onMutate: (vars: {
			applicationId: string
			alts: Array<{ characterId: string; characterName?: string }>
			actorCharacterId?: string
			actorCharacterName?: string
		}) => {
			const detailKey = applicationKeys.detail(vars.applicationId)
			const activityKey = applicationKeys.activity(vars.applicationId)

			const prevDetail = queryClient.getQueryData<Application>(detailKey)
			const prevActivity = queryClient.getQueryData<ApplicationActivityLogEntry[]>(activityKey)

			queryClient.setQueryData<Application>(detailKey, (old) =>
				old
					? {
							...old,
							altCharacterIds: [
								...(old.altCharacterIds ?? []),
								...vars.alts.map((a) => a.characterId),
							],
						}
					: old
			)
			queryClient.setQueryData<ApplicationActivityLogEntry[]>(activityKey, (old) => [
				...vars.alts.map((alt, i) => ({
					id: `optimistic-${Date.now()}-${i}`,
					applicationId: vars.applicationId,
					action: 'alt_added' as const,
					characterId: vars.actorCharacterId ?? '',
					characterName: vars.actorCharacterName,
					previousValue: undefined,
					newValue: alt.characterId,
					metadata: alt.characterName ? { altCharacterName: alt.characterName } : undefined,
					timestamp: new Date().toISOString(),
				})),
				...(old ?? []),
			])

			return { prevDetail, prevActivity }
		},
		onError: (
			_err: unknown,
			vars: { applicationId: string; [key: string]: unknown },
			ctx: { prevDetail?: Application; prevActivity?: ApplicationActivityLogEntry[] } | undefined
		) => {
			if (ctx?.prevDetail !== undefined)
				queryClient.setQueryData(applicationKeys.detail(vars.applicationId), ctx.prevDetail)
			if (ctx?.prevActivity !== undefined)
				queryClient.setQueryData(applicationKeys.activity(vars.applicationId), ctx.prevActivity)
		},
		onSettled: (
			_: unknown,
			__: unknown,
			vars: { applicationId: string; [key: string]: unknown }
		) => {
			void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(vars.applicationId) })
			void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: applicationKeys.activity(vars.applicationId) })
		},
	}
}

function makeRemoveAltMutationHandlers(queryClient: QueryClient) {
	return {
		mutationFn: vi.fn(),
		onMutate: (vars: {
			applicationId: string
			altCharacterId: string
			altCharacterName?: string
			actorCharacterId?: string
			actorCharacterName?: string
		}) => {
			const detailKey = applicationKeys.detail(vars.applicationId)
			const activityKey = applicationKeys.activity(vars.applicationId)

			const prevDetail = queryClient.getQueryData<Application>(detailKey)
			const prevActivity = queryClient.getQueryData<ApplicationActivityLogEntry[]>(activityKey)

			queryClient.setQueryData<Application>(detailKey, (old) =>
				old
					? {
							...old,
							altCharacterIds: (old.altCharacterIds ?? []).filter(
								(id) => id !== vars.altCharacterId
							),
						}
					: old
			)
			queryClient.setQueryData<ApplicationActivityLogEntry[]>(activityKey, (old) => [
				{
					id: `optimistic-${Date.now()}`,
					applicationId: vars.applicationId,
					action: 'alt_removed' as const,
					characterId: vars.actorCharacterId ?? '',
					characterName: vars.actorCharacterName,
					previousValue: vars.altCharacterId,
					newValue: undefined,
					metadata: vars.altCharacterName ? { altCharacterName: vars.altCharacterName } : undefined,
					timestamp: new Date().toISOString(),
				},
				...(old ?? []),
			])

			return { prevDetail, prevActivity }
		},
		onError: (
			_err: unknown,
			vars: { applicationId: string; [key: string]: unknown },
			ctx: { prevDetail?: Application; prevActivity?: ApplicationActivityLogEntry[] } | undefined
		) => {
			if (ctx?.prevDetail !== undefined)
				queryClient.setQueryData(applicationKeys.detail(vars.applicationId), ctx.prevDetail)
			if (ctx?.prevActivity !== undefined)
				queryClient.setQueryData(applicationKeys.activity(vars.applicationId), ctx.prevActivity)
		},
		onSettled: (
			_: unknown,
			__: unknown,
			vars: { applicationId: string; [key: string]: unknown }
		) => {
			void queryClient.invalidateQueries({ queryKey: applicationKeys.detail(vars.applicationId) })
			void queryClient.invalidateQueries({ queryKey: applicationKeys.lists() })
			void queryClient.invalidateQueries({ queryKey: applicationKeys.activity(vars.applicationId) })
		},
	}
}

// ============================================================================
// useAddApplicationAlt — optimistic cache logic
// ============================================================================

describe('useAddApplicationAlt — onMutate', () => {
	let queryClient: QueryClient

	beforeEach(() => {
		queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	})

	it('appends alt IDs to the detail cache', () => {
		queryClient.setQueryData(
			applicationKeys.detail('app-1'),
			makeApplication({ altCharacterIds: ['existing-alt'] })
		)

		const { onMutate } = makeAddAltMutationHandlers(queryClient)
		onMutate({
			applicationId: 'app-1',
			alts: [{ characterId: 'new-alt', characterName: 'New Alt' }],
			actorCharacterId: '1001',
			actorCharacterName: 'Main Pilot',
		})

		const detail = queryClient.getQueryData<Application>(applicationKeys.detail('app-1'))
		expect(detail?.altCharacterIds).toEqual(['existing-alt', 'new-alt'])
	})

	it('prepends one activity entry per alt into activity cache', () => {
		queryClient.setQueryData(applicationKeys.activity('app-1'), [makeActivityEntry()])

		const { onMutate } = makeAddAltMutationHandlers(queryClient)
		onMutate({
			applicationId: 'app-1',
			alts: [
				{ characterId: 'alt-2001', characterName: 'Alt One' },
				{ characterId: 'alt-2002', characterName: 'Alt Two' },
			],
			actorCharacterId: '1001',
			actorCharacterName: 'Main Pilot',
		})

		const activity = queryClient.getQueryData<ApplicationActivityLogEntry[]>(
			applicationKeys.activity('app-1')
		)
		expect(activity).toHaveLength(3) // 2 optimistic + 1 existing
		expect(activity![0]).toMatchObject({
			action: 'alt_added',
			newValue: 'alt-2001',
			metadata: { altCharacterName: 'Alt One' },
		})
		expect(activity![1]).toMatchObject({
			action: 'alt_added',
			newValue: 'alt-2002',
			metadata: { altCharacterName: 'Alt Two' },
		})
	})

	it('returns previous cache state for rollback', () => {
		const prevApp = makeApplication({ altCharacterIds: ['old-alt'] })
		const prevLog = [makeActivityEntry()]
		queryClient.setQueryData(applicationKeys.detail('app-1'), prevApp)
		queryClient.setQueryData(applicationKeys.activity('app-1'), prevLog)

		const { onMutate } = makeAddAltMutationHandlers(queryClient)
		const ctx = onMutate({ applicationId: 'app-1', alts: [{ characterId: 'new-alt' }] })

		expect(ctx.prevDetail).toStrictEqual(prevApp)
		expect(ctx.prevActivity).toStrictEqual(prevLog)
	})

	it('handles empty cache gracefully', () => {
		const { onMutate } = makeAddAltMutationHandlers(queryClient)
		expect(() =>
			onMutate({ applicationId: 'app-1', alts: [{ characterId: 'alt-2001' }] })
		).not.toThrow()
	})
})

describe('useAddApplicationAlt — onError rollback', () => {
	let queryClient: QueryClient

	beforeEach(() => {
		queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	})

	it('restores both caches to previous state on error', () => {
		const prevApp = makeApplication({ altCharacterIds: [] })
		const prevLog: ApplicationActivityLogEntry[] = []
		queryClient.setQueryData(applicationKeys.detail('app-1'), prevApp)
		queryClient.setQueryData(applicationKeys.activity('app-1'), prevLog)

		const handlers = makeAddAltMutationHandlers(queryClient)
		const ctx = handlers.onMutate({ applicationId: 'app-1', alts: [{ characterId: 'alt-2001' }] })

		// Cache is now modified — simulate error and rollback
		handlers.onError(new Error('fail'), { applicationId: 'app-1', alts: [] }, ctx)

		expect(queryClient.getQueryData(applicationKeys.detail('app-1'))).toStrictEqual(prevApp)
		expect(queryClient.getQueryData(applicationKeys.activity('app-1'))).toStrictEqual(prevLog)
	})
})

// ============================================================================
// useRemoveApplicationAlt — optimistic cache logic
// ============================================================================

describe('useRemoveApplicationAlt — onMutate', () => {
	let queryClient: QueryClient

	beforeEach(() => {
		queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	})

	it('removes the alt ID from the detail cache', () => {
		queryClient.setQueryData(
			applicationKeys.detail('app-1'),
			makeApplication({ altCharacterIds: ['alt-2001', 'alt-2002'] })
		)

		const { onMutate } = makeRemoveAltMutationHandlers(queryClient)
		onMutate({
			applicationId: 'app-1',
			altCharacterId: 'alt-2001',
			altCharacterName: 'Alt One',
			actorCharacterId: '1001',
			actorCharacterName: 'Main Pilot',
		})

		const detail = queryClient.getQueryData<Application>(applicationKeys.detail('app-1'))
		expect(detail?.altCharacterIds).toEqual(['alt-2002'])
	})

	it('prepends an alt_removed activity entry with altCharacterName in metadata', () => {
		queryClient.setQueryData(applicationKeys.activity('app-1'), [makeActivityEntry()])

		const { onMutate } = makeRemoveAltMutationHandlers(queryClient)
		onMutate({
			applicationId: 'app-1',
			altCharacterId: 'alt-2001',
			altCharacterName: 'Alt One',
			actorCharacterId: '1001',
			actorCharacterName: 'Main Pilot',
		})

		const activity = queryClient.getQueryData<ApplicationActivityLogEntry[]>(
			applicationKeys.activity('app-1')
		)
		expect(activity).toHaveLength(2)
		expect(activity![0]).toMatchObject({
			action: 'alt_removed',
			previousValue: 'alt-2001',
			metadata: { altCharacterName: 'Alt One' },
			characterId: '1001',
			characterName: 'Main Pilot',
		})
	})

	it('returns previous cache state for rollback', () => {
		const prevApp = makeApplication({ altCharacterIds: ['alt-2001'] })
		const prevLog = [makeActivityEntry()]
		queryClient.setQueryData(applicationKeys.detail('app-1'), prevApp)
		queryClient.setQueryData(applicationKeys.activity('app-1'), prevLog)

		const { onMutate } = makeRemoveAltMutationHandlers(queryClient)
		const ctx = onMutate({ applicationId: 'app-1', altCharacterId: 'alt-2001' })

		expect(ctx.prevDetail).toStrictEqual(prevApp)
		expect(ctx.prevActivity).toStrictEqual(prevLog)
	})
})

describe('useRemoveApplicationAlt — onError rollback', () => {
	let queryClient: QueryClient

	beforeEach(() => {
		queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	})

	it('restores both caches to previous state on error', () => {
		const prevApp = makeApplication({ altCharacterIds: ['alt-2001'] })
		const prevLog = [makeActivityEntry()]
		queryClient.setQueryData(applicationKeys.detail('app-1'), prevApp)
		queryClient.setQueryData(applicationKeys.activity('app-1'), prevLog)

		const handlers = makeRemoveAltMutationHandlers(queryClient)
		const ctx = handlers.onMutate({
			applicationId: 'app-1',
			altCharacterId: 'alt-2001',
			altCharacterName: 'Alt One',
		})

		handlers.onError(new Error('fail'), { applicationId: 'app-1', altCharacterId: 'alt-2001' }, ctx)

		expect(queryClient.getQueryData(applicationKeys.detail('app-1'))).toStrictEqual(prevApp)
		expect(queryClient.getQueryData(applicationKeys.activity('app-1'))).toStrictEqual(prevLog)
	})
})
