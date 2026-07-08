import { describe, expect, it } from 'vitest'

import {
	groupDiscordRoleAssignmentSections,
	groupDiscordRoleAssignmentSummary,
} from '@/routes/admin/group-discord-role-sections'

describe('group Discord role assignment sections', () => {
	it('documents the member and owner/admin buckets explicitly', () => {
		expect(groupDiscordRoleAssignmentSections).toEqual([
			{
				membershipType: 'member',
				label: 'Members',
				description: 'Roles for everyone in the group.',
			},
			{
				membershipType: 'owner_admin',
				label: 'Owners/Admins',
				description: 'Roles for group owners and admins. These stack with member roles.',
			},
		])
		expect(groupDiscordRoleAssignmentSummary).toContain('Member roles apply to every group member')
		expect(groupDiscordRoleAssignmentSummary).toContain('Owner/Admin roles stack on top')
	})
})
