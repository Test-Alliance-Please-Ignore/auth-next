import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	groupKeys,
	useAcceptInvitation,
	useCreateJoinRequest,
	useJoinGroup,
	useRedeemInviteCode,
} from '@/hooks/useGroups'
import { I18nProvider, setAppLocale } from '@/i18n'
import { api } from '@/lib/api'

import type { UseApiMutationOptions } from '@/hooks/useApiMutation'
import type {
	CreateJoinRequestRequest,
	GroupJoinRequest,
	RedeemInviteCodeResponse,
} from '@/lib/api'

const captured = vi.hoisted(() => ({ options: null as unknown }))

vi.mock('@/hooks/useApiMutation', () => ({
	useApiMutation: (options: unknown) => {
		captured.options = options
		return { isPending: false }
	},
}))

function captureMutation<TData, TVariables>(useHook: () => unknown, client = new QueryClient()) {
	function Harness() {
		useHook()
		return null
	}
	// Only the notification/mutation boundary is mocked; group hook callbacks are real.
	renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<I18nProvider>
				<Harness />
			</I18nProvider>
		</QueryClientProvider>
	)
	return captured.options as UseApiMutationOptions<TData, TVariables>
}

describe('localized group mutation feedback', () => {
	afterEach(async () => {
		await setAppLocale('en', { persistLocal: false })
		vi.restoreAllMocks()
	})

	it('uses the active locale when an asynchronous notification arrives', async () => {
		await setAppLocale('en', { persistLocal: false })
		const options = captureMutation<void, string>(useJoinGroup)
		expect(typeof options.successMessage).toBe('function')
		if (typeof options.successMessage !== 'function') throw new Error('Expected lazy feedback')

		await setAppLocale('de', { persistLocal: false })
		expect(options.successMessage(undefined, 'group-1')).toBe('Du bist der Gruppe beigetreten')
		await setAppLocale('ko', { persistLocal: false })
		expect(options.successMessage(undefined, 'group-1')).toBe('그룹에 가입했습니다.')

		if (typeof options.errorMessage !== 'function') throw new Error('Expected error formatter')
		expect(options.errorMessage(new Error('Raw backend diagnostic'))).toBe('Raw backend diagnostic')
		expect(options.errorMessage(new Error(''))).toBe('오류가 발생했습니다. 다시 시도해 주세요.')
	})

	it('does not translate membership request fields, user content, or cache keys', async () => {
		await setAppLocale('ko', { persistLocal: false })
		const request = { groupId: 'group-1', reason: 'Keep my English application text' }
		const result: GroupJoinRequest = {
			id: 'request-1',
			...request,
			userId: 'user-1',
			status: 'pending',
			createdAt: '2026-09-10T12:00:00Z',
			respondedAt: null,
			respondedBy: null,
		}
		const create = vi.spyOn(api, 'createJoinRequest').mockResolvedValue(result)
		const options = captureMutation<GroupJoinRequest, CreateJoinRequestRequest>(
			useCreateJoinRequest
		)
		expect(await options.mutationFn(request)).toBe(result)
		expect(create).toHaveBeenCalledWith(request)
		expect(groupKeys.list({ joinMode: 'approval', search: 'Alpha' })).toEqual([
			'admin',
			'groups',
			'list',
			{ joinMode: 'approval', search: 'Alpha' },
		])
	})

	it('preserves invite codes and group names in redemption', async () => {
		await setAppLocale('de', { persistLocal: false })
		const response: RedeemInviteCodeResponse = {
			success: true,
			message: 'Server-provided success text',
			group: {
				id: 'group-1',
				categoryId: 'category-1',
				name: 'Alpha Pilots',
				description: null,
				visibility: 'hidden',
				joinMode: 'invitation_only',
				mumbleSyncEnabled: false,
				ownerId: 'owner-1',
				createdAt: '2026-09-10T12:00:00Z',
				updatedAt: '2026-09-10T12:00:00Z',
			},
		}
		const redeem = vi.spyOn(api, 'redeemInviteCode').mockResolvedValue(response)
		const options = captureMutation<RedeemInviteCodeResponse, string>(useRedeemInviteCode)
		expect(await options.mutationFn('Keep-Exact-Code')).toBe(response)
		expect(redeem).toHaveBeenCalledWith('Keep-Exact-Code')
		if (typeof options.successMessage !== 'function') throw new Error('Expected lazy feedback')
		expect(options.successMessage(response, 'Keep-Exact-Code')).toBe(
			'Du bist „Alpha Pilots“ beigetreten'
		)
	})

	it('still refreshes invitations, memberships, group lists, and session permissions after acceptance', async () => {
		const client = new QueryClient()
		const invalidate = vi.spyOn(client, 'invalidateQueries')
		const options = captureMutation<void, string>(useAcceptInvitation, client)
		await options.onSuccess?.(undefined, 'invitation-1', undefined)
		expect(invalidate).toHaveBeenCalledTimes(4)
		for (const queryKey of [
			groupKeys.invitations(),
			groupKeys.userMemberships(),
			groupKeys.lists(),
			['auth', 'session'],
		]) {
			expect(invalidate).toHaveBeenCalledWith({ queryKey })
		}
		client.clear()
	})
})
