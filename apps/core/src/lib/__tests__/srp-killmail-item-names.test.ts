import { describe, expect, it } from 'vitest'

import { collectKillmailItemTypeIds } from '@repo/srp'

describe('collectKillmailItemTypeIds', () => {
	it('collects ship maintenance bay contents for visible item metadata', () => {
		const ids = collectKillmailItemTypeIds([
			{
				flag: 90,
				item_type_id: 11400,
				items: [{ flag: 27, item_type_id: 4292 }],
			},
		] as never)

		expect(ids).toEqual(['11400', '4292'])
	})
})
