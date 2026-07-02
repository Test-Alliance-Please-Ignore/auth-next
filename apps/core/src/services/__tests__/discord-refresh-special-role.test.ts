import { describe, expect, it } from 'vitest'

import {
	augmentRequestedRoleIdsForRefresh,
	calculateRoleChanges,
} from '../../../../discord/src/utils/role-calculation'

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

	it('preserves the special auth role during removal-mode updates', () => {
		const result = calculateRoleChanges({
			currentRoleIds: ['managed-role', '1431816436640256060'],
			requestedRoleIds: ['managed-role'],
			managedRoleIds: ['managed-role', '1431816436640256060'],
			preserveRoleIds: ['1431816436640256060'],
			isAddOnlyMode: false,
		})

		expect(result.newRoleIds).toContain('1431816436640256060')
		expect(result.rolesRemoved).not.toContain('1431816436640256060')
	})
})
