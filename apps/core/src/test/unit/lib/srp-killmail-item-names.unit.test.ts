import { describe, expect, it } from 'vitest'

import { collectKillmailItemTypeIds } from '@repo/srp'

describe('collectKillmailItemTypeIds', () => {
	it('collects nested killmail item type IDs and preserves string ids', () => {
		const ids = collectKillmailItemTypeIds([
			{
				item_type_id: 29618,
				items: [
					{
						item_type_id: '41275',
					},
					{
						type_id: 41277,
						items: [
							{
								typeId: '29620',
							},
						],
					},
				],
			},
			{
				item_type_id: '29618',
			},
			{
				items: [
					{
						item_type_id: null as unknown as number,
					},
				],
			},
		] as never)

		expect(ids).toEqual(['29618', '41275', '41277', '29620'])
	})
})
