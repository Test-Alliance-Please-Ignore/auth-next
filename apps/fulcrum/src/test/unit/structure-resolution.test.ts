import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StructureResolutionCoordinator } from '../../workflows/processors/helpers/structure-resolution'

const fetchStructureInfo = vi.fn()

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(() => ({
		fetchStructureInfo,
	})),
}))

vi.mock('@repo/workflow-utils', () => ({
	parseEsiErrorMetadata: () => null,
	retryWithBackoff: async <T>(fn: () => Promise<T>) => fn(),
}))

describe('structure resolution', () => {
	beforeEach(() => {
		fetchStructureInfo.mockReset()
	})

	it('caches forbidden structures and skips future lookups in the same report', async () => {
		const state = new StructureResolutionCoordinator()
		const deniedError = new Error(
			'ESI request failed: 403 Forbidden - {"error":"access denied"} | metadata={"status":403,"path":"/latest/universe/structures/123/"}',
		)
		fetchStructureInfo.mockRejectedValue(deniedError)

		const first = await state.resolveStructureNames(
			{ ESI: {} as DurableObjectNamespace },
			'93665130',
			['123'],
			'test-structure-resolution',
		)

		expect(first).toEqual({})
		expect(fetchStructureInfo).toHaveBeenCalledTimes(1)
		expect(state.getDeniedCount()).toBe(1)

		const second = await state.resolveStructureNames(
			{ ESI: {} as DurableObjectNamespace },
			'93665130',
			['123'],
			'test-structure-resolution',
		)

		expect(second).toEqual({})
		expect(fetchStructureInfo).toHaveBeenCalledTimes(1)
	})
})
