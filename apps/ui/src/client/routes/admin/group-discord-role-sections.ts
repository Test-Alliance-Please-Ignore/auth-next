export const groupDiscordRoleAssignmentSections = [
	{
		membershipType: 'member' as const,
		label: 'Members',
		description: 'Roles for everyone in the group.',
	},
	{
		membershipType: 'owner_admin' as const,
		label: 'Owners/Admins',
		description: 'Roles for group owners and admins. These stack with member roles.',
	},
] as const

export const groupDiscordRoleAssignmentSummary =
	'Member roles apply to every group member. Owner/Admin roles stack on top for group owners and admins.'
