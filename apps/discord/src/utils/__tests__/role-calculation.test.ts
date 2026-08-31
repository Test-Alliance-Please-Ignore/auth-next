import { describe, expect, it } from 'vitest'

import { findUnmanagedRequestedRoleIds } from '../role-calculation'

describe('findUnmanagedRequestedRoleIds', () => {
	it('allows managed and explicitly preserved roles', () => {
		expect(
			findUnmanagedRequestedRoleIds({
				requestedRoleIds: ['managed', 'preserved'],
				managedRoleIds: ['managed'],
				preserveRoleIds: ['preserved'],
			})
		).toEqual([])
	})

	it('returns unique role IDs outside both allowlists', () => {
		expect(
			findUnmanagedRequestedRoleIds({
				requestedRoleIds: ['guild-role-1', 'guild-role-1', 'guild-role-2'],
				managedRoleIds: ['managed'],
			})
		).toEqual(['guild-role-1', 'guild-role-2'])
	})
})
