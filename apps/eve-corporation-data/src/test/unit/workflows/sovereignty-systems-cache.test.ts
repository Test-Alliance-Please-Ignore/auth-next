import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { refreshSharedSovereigntySystems } from '../../../workflows/utils/sovereignty-systems-cache'

describe('refreshSharedSovereigntySystems', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns the fresh snapshot without acquiring a lease or fetching ESI', async () => {
		const getSharedSovereigntySystemsSnapshotMock = vi.fn().mockResolvedValue([
			{ system_id: '30000142' },
		])
		const acquireSharedSovereigntySystemsRefreshLeaseMock = vi.fn()
		const releaseSharedSovereigntySystemsRefreshLeaseMock = vi.fn()
		const storeSharedSovereigntySystemsMock = vi.fn()

		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			acquireSharedSovereigntySystemsRefreshLease:
				acquireSharedSovereigntySystemsRefreshLeaseMock,
			releaseSharedSovereigntySystemsRefreshLease:
				releaseSharedSovereigntySystemsRefreshLeaseMock,
			storeSharedSovereigntySystems: storeSharedSovereigntySystemsMock,
			getSharedSovereigntySystemsSnapshot: getSharedSovereigntySystemsSnapshotMock,
		})

		const result = await refreshSharedSovereigntySystems({} as never)

		expect(getSharedSovereigntySystemsSnapshotMock).toHaveBeenCalled()
		expect(acquireSharedSovereigntySystemsRefreshLeaseMock).not.toHaveBeenCalled()
		expect(mocks.fetchSovereigntySystemsMock).not.toHaveBeenCalled()
		expect(storeSharedSovereigntySystemsMock).not.toHaveBeenCalled()
		expect(releaseSharedSovereigntySystemsRefreshLeaseMock).not.toHaveBeenCalled()
		expect(result).toEqual([{ system_id: '30000142' }])
	})

	it('uses the lease holder to refresh the snapshot and releases the lease afterward', async () => {
		const releaseSharedSovereigntySystemsRefreshLeaseMock = vi.fn()
		const storeSharedSovereigntySystemsMock = vi.fn()
		const getSharedSovereigntySystemsSnapshotMock = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(null)
		const acquireSharedSovereigntySystemsRefreshLeaseMock = vi
			.fn()
			.mockResolvedValue('lease-token')

		mocks.createTokenStoreMock.mockReturnValue({})
		mocks.fetchSovereigntySystemsMock.mockResolvedValue([{ system_id: '30000142' }])
		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			acquireSharedSovereigntySystemsRefreshLease:
				acquireSharedSovereigntySystemsRefreshLeaseMock,
			releaseSharedSovereigntySystemsRefreshLease:
				releaseSharedSovereigntySystemsRefreshLeaseMock,
			storeSharedSovereigntySystems: storeSharedSovereigntySystemsMock,
			getSharedSovereigntySystemsSnapshot: getSharedSovereigntySystemsSnapshotMock,
		})

		const result = await refreshSharedSovereigntySystems({} as never)

		expect(acquireSharedSovereigntySystemsRefreshLeaseMock).toHaveBeenCalledWith()
		expect(mocks.createTokenStoreMock).toHaveBeenCalledWith({})
		expect(mocks.fetchSovereigntySystemsMock).toHaveBeenCalledWith({})
		expect(storeSharedSovereigntySystemsMock).toHaveBeenCalledWith([{ system_id: '30000142' }])
		expect(releaseSharedSovereigntySystemsRefreshLeaseMock).toHaveBeenCalledWith('lease-token')
		expect(result).toEqual([{ system_id: '30000142' }])
		expect(getSharedSovereigntySystemsSnapshotMock).toHaveBeenCalledTimes(2)
	})

	it('falls back to the existing snapshot when another refresh already holds the lease', async () => {
		const releaseSharedSovereigntySystemsRefreshLeaseMock = vi.fn()
		const storeSharedSovereigntySystemsMock = vi.fn()
		const getSharedSovereigntySystemsSnapshotMock = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce([{ system_id: '30000142' }])
		const acquireSharedSovereigntySystemsRefreshLeaseMock = vi.fn().mockResolvedValue(null)

		mocks.createTokenStoreMock.mockReturnValue({})
		mocks.getGlobalCorporationDataStubMock.mockReturnValue({
			acquireSharedSovereigntySystemsRefreshLease:
				acquireSharedSovereigntySystemsRefreshLeaseMock,
			releaseSharedSovereigntySystemsRefreshLease:
				releaseSharedSovereigntySystemsRefreshLeaseMock,
			storeSharedSovereigntySystems: storeSharedSovereigntySystemsMock,
			getSharedSovereigntySystemsSnapshot: getSharedSovereigntySystemsSnapshotMock,
		})

		const result = await refreshSharedSovereigntySystems({} as never)

		expect(acquireSharedSovereigntySystemsRefreshLeaseMock).toHaveBeenCalledWith()
		expect(mocks.fetchSovereigntySystemsMock).not.toHaveBeenCalled()
		expect(storeSharedSovereigntySystemsMock).not.toHaveBeenCalled()
		expect(releaseSharedSovereigntySystemsRefreshLeaseMock).not.toHaveBeenCalled()
		expect(getSharedSovereigntySystemsSnapshotMock).toHaveBeenCalledTimes(2)
		expect(result).toEqual([{ system_id: '30000142' }])
	})
})
