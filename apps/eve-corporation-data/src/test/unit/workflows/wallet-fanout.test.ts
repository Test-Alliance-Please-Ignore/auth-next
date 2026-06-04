import { describe, expect, it } from 'vitest'

import { getWalletDivisionJitterMs } from '../../../workflows/utils/wallet-fanout'

describe('wallet fanout jitter', () => {
	it('spreads the seven wallet divisions across a ten second window', () => {
		expect(Array.from({ length: 7 }, (_, index) => getWalletDivisionJitterMs(index, 7))).toEqual([
			0,
			1667,
			3333,
			5000,
			6667,
			8333,
			10000,
		])
	})

	it('does not add jitter when there is only one division', () => {
		expect(getWalletDivisionJitterMs(0, 1)).toBe(0)
	})
})
