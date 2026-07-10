import { beforeEach, describe, expect, it, vi } from 'vitest'

import { corporationTaxKeys, useTaxMemberSummary } from '../../client/hooks/corporation-tax'
import { CorporationTaxApiClient } from '../../client/lib/tax-api'

const { useQueryMock } = vi.hoisted(() => ({
	useQueryMock: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
	useQuery: (...args: unknown[]) => useQueryMock(...args),
}))

describe('useTaxMemberSummary', () => {
	beforeEach(() => {
		useQueryMock.mockReset()
		useQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isFetching: false,
			error: undefined,
			refetch: vi.fn(),
		})
	})

	it('keeps the query disabled until a corporation id is available', async () => {
		const filters: NonNullable<Parameters<typeof useTaxMemberSummary>[1]> = {
			characterQuery: 'Zen',
			fromDate: '2026-07-01T00:00:00.000Z',
			toDate: '2026-07-31T23:59:59.999Z',
			limit: 25,
			offset: 0,
			sortBy: 'contributionIncome',
			sortDir: 'desc',
			enabled: true,
		}

		useTaxMemberSummary(undefined, filters)

		expect(useQueryMock).toHaveBeenCalledTimes(1)
		const options = useQueryMock.mock.calls[0][0] as {
			enabled: boolean
			queryKey: unknown
			queryFn: () => Promise<unknown>
		}
		expect(options.enabled).toBe(false)
		expect(options.queryKey).toEqual(corporationTaxKeys.memberSummary('none', filters))
		expect(() => options.queryFn()).toThrow('Corporation id is required for member summary')
	})
})

describe('CorporationTaxApiClient.getMemberSummary', () => {
	beforeEach(() => {
		vi.unstubAllGlobals()
	})

	it('rejects missing corporation ids before issuing a request', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)

		const client = new CorporationTaxApiClient('/api')

		await expect(client.getMemberSummary('' as unknown as string)).rejects.toThrow(
			'Corporation id is required for member summary'
		)
		expect(fetchSpy).not.toHaveBeenCalled()
	})
})
