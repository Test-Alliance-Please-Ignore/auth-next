import { describe, expect, it, vi } from 'vitest'

import { EveCorporationDataWorker } from '../../index'

const { getStubMock } = vi.hoisted(() => ({
	getStubMock: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: getStubMock,
}))

describe('EveCorporationDataWorker', () => {
	it('returns per-corporation counts while isolating failed lookups', async () => {
		const corporationStubs = new Map([
			[
				'corp-1',
				{
					getHealthyDirectorCount: vi.fn().mockResolvedValue(2),
				},
			],
			[
				'corp-2',
				{
					getHealthyDirectorCount: vi.fn().mockRejectedValue(new Error('DO unavailable')),
				},
			],
		])
		getStubMock.mockImplementation((_binding: unknown, corporationId: string) => {
			return corporationStubs.get(corporationId)
		})

		const worker = new EveCorporationDataWorker({} as never, { EVE_CORPORATION_DATA: {} } as never)

		await expect(worker.getHealthyDirectorCounts(['corp-1', 'corp-1', 'corp-2'])).resolves.toEqual({
			'corp-1': 2,
			'corp-2': null,
		})
		expect(getStubMock).toHaveBeenCalledTimes(2)
		expect(getStubMock).toHaveBeenNthCalledWith(1, expect.anything(), 'corp-1')
		expect(getStubMock).toHaveBeenNthCalledWith(2, expect.anything(), 'corp-2')
		expect(corporationStubs.get('corp-1')?.getHealthyDirectorCount).toHaveBeenCalledWith('corp-1')
		expect(corporationStubs.get('corp-2')?.getHealthyDirectorCount).toHaveBeenCalledWith('corp-2')
	})
})
