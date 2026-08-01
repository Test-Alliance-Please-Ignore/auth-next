import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	ensureSharedSovereigntySystems,
	refreshSharedSovereigntySystems,
} from '../../../workflows/utils/sovereignty-systems-cache'

const mocks = vi.hoisted(() => {
	const fetchSovereigntySystemsMock = vi.fn()
	const createTokenStoreMock = vi.fn()
	const getGlobalCorporationDataStubMock = vi.fn()

	return {
		fetchSovereigntySystemsMock,
		createTokenStoreMock,
		getGlobalCorporationDataStubMock,
	}
})

vi.mock('../../../services/esi-fetch', () => ({
	fetchSovereigntySystems: (...args: unknown[]) => mocks.fetchSovereigntySystemsMock(...args),
}))

vi.mock('../../../workflows/utils/services', () => ({
	createTokenStore: (...args: unknown[]) => mocks.createTokenStoreMock(...args),
	getGlobalCorporationDataStub: (...args: unknown[]) =>
		mocks.getGlobalCorporationDataStubMock(...args),
}))

describe('ensureSharedSovereigntySystems', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('checks only the freshness metadata for an existing snapshot', async () => {
		const hasFreshSharedSovereigntySystemsMock = vi.fn().mockResolvedValue(true)
		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			hasFreshSharedSovereigntySystems: hasFreshSharedSovereigntySystemsMock,
		})

		await expect(ensureSharedSovereigntySystems({} as never)).resolves.toBeUndefined()

		expect(hasFreshSharedSovereigntySystemsMock).toHaveBeenCalledWith(60 * 60)
	})

	it('refreshes when the metadata is absent or stale', async () => {
		const hasFreshSharedSovereigntySystemsMock = vi.fn().mockResolvedValue(false)
		const acquireSharedSovereigntySystemsRefreshLeaseMock = vi.fn().mockResolvedValue('lease-token')
		const releaseSharedSovereigntySystemsRefreshLeaseMock = vi.fn()
		const storeSharedSovereigntySystemsMock = vi.fn()

		mocks.createTokenStoreMock.mockReturnValue({})
		mocks.fetchSovereigntySystemsMock.mockResolvedValue([{ system_id: '30000142' }])
		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			hasFreshSharedSovereigntySystems: hasFreshSharedSovereigntySystemsMock,
			acquireSharedSovereigntySystemsRefreshLease: acquireSharedSovereigntySystemsRefreshLeaseMock,
			releaseSharedSovereigntySystemsRefreshLease: releaseSharedSovereigntySystemsRefreshLeaseMock,
			storeSharedSovereigntySystems: storeSharedSovereigntySystemsMock,
		})

		await ensureSharedSovereigntySystems({} as never)

		expect(acquireSharedSovereigntySystemsRefreshLeaseMock).toHaveBeenCalledWith()
		expect(mocks.fetchSovereigntySystemsMock).toHaveBeenCalledWith({})
		expect(storeSharedSovereigntySystemsMock).toHaveBeenCalledWith([{ system_id: '30000142' }])
		expect(releaseSharedSovereigntySystemsRefreshLeaseMock).toHaveBeenCalledWith('lease-token')
	})
})

describe('refreshSharedSovereigntySystems', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('refreshes under the lease without clearing the last good snapshot first', async () => {
		const acquireSharedSovereigntySystemsRefreshLeaseMock = vi.fn().mockResolvedValue('lease-token')
		const releaseSharedSovereigntySystemsRefreshLeaseMock = vi.fn()
		const storeSharedSovereigntySystemsMock = vi.fn()

		mocks.createTokenStoreMock.mockReturnValue({})
		mocks.fetchSovereigntySystemsMock.mockResolvedValue([{ system_id: '30000142' }])
		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			acquireSharedSovereigntySystemsRefreshLease: acquireSharedSovereigntySystemsRefreshLeaseMock,
			releaseSharedSovereigntySystemsRefreshLease: releaseSharedSovereigntySystemsRefreshLeaseMock,
			storeSharedSovereigntySystems: storeSharedSovereigntySystemsMock,
		})

		await expect(refreshSharedSovereigntySystems({} as never)).resolves.toBeUndefined()

		expect(mocks.fetchSovereigntySystemsMock).toHaveBeenCalledWith({})
		expect(storeSharedSovereigntySystemsMock).toHaveBeenCalledWith([{ system_id: '30000142' }])
		expect(releaseSharedSovereigntySystemsRefreshLeaseMock).toHaveBeenCalledWith('lease-token')
	})

	it('waits for the active lease holder using metadata-only checks', async () => {
		const hasFreshSharedSovereigntySystemsMock = vi
			.fn()
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true)
		const acquireSharedSovereigntySystemsRefreshLeaseMock = vi.fn().mockResolvedValue(null)

		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			hasFreshSharedSovereigntySystems: hasFreshSharedSovereigntySystemsMock,
			acquireSharedSovereigntySystemsRefreshLease: acquireSharedSovereigntySystemsRefreshLeaseMock,
		})

		await expect(refreshSharedSovereigntySystems({} as never)).resolves.toBeUndefined()
		expect(hasFreshSharedSovereigntySystemsMock).toHaveBeenCalledTimes(2)
		expect(mocks.fetchSovereigntySystemsMock).not.toHaveBeenCalled()
	})

	it('fails after the lease holder does not publish a fresh snapshot', async () => {
		vi.useFakeTimers()
		try {
			const hasFreshSharedSovereigntySystemsMock = vi.fn().mockResolvedValue(false)
			const acquireSharedSovereigntySystemsRefreshLeaseMock = vi.fn().mockResolvedValue(null)
			mocks.getGlobalCorporationDataStubMock.mockReturnValue({
				hasFreshSharedSovereigntySystems: hasFreshSharedSovereigntySystemsMock,
				acquireSharedSovereigntySystemsRefreshLease:
					acquireSharedSovereigntySystemsRefreshLeaseMock,
			})

			const refreshAssertion = expect(refreshSharedSovereigntySystems({} as never)).rejects.toThrow(
				'Failed to refresh shared sovereignty systems snapshot'
			)
			await vi.advanceTimersByTimeAsync(32_000)

			await refreshAssertion
		} finally {
			vi.useRealTimers()
		}
	})
})
