import { describe, expect, it } from 'vitest'

import { augmentRequestedRoleIdsForRefresh } from '../../../../discord/src/utils/role-calculation'

describe('augmentRequestedRoleIdsForRefresh', () => {
	it('adds special refresh roles when the guild exposes them', () => {
		const result = augmentRequestedRoleIdsForRefresh({
			requestedRoleIds: ['managed-role'],
			guildRoleIds: ['managed-role', '1431816436640256060'],
			specialRoleIds: ['1431816436640256060'],
		})

		expect(result).toEqual(['managed-role', '1431816436640256060'])
	})

	it('does not add special refresh roles when the guild does not expose them', () => {
		const result = augmentRequestedRoleIdsForRefresh({
			requestedRoleIds: ['managed-role'],
			guildRoleIds: ['managed-role'],
			specialRoleIds: ['1431816436640256060'],
		})

		expect(result).toEqual(['managed-role'])
	})

	it('deduplicates requested roles', () => {
		const result = augmentRequestedRoleIdsForRefresh({
			requestedRoleIds: ['managed-role', 'managed-role'],
			guildRoleIds: ['managed-role', '1431816436640256060'],
			specialRoleIds: ['1431816436640256060'],
		})

		expect(result).toEqual(['managed-role', '1431816436640256060'])
	})
})
