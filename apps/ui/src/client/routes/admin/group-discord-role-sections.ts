export const groupDiscordRoleAssignmentSections = [
	{
		membershipType: 'member' as const,
		labelKey: 'admin.organizations.group.members',
		descriptionKey: 'admin.organizations.discord.memberDescription',
	},
	{
		membershipType: 'owner_admin' as const,
		labelKey: 'admin.organizations.discord.ownersAdmins',
		descriptionKey: 'admin.organizations.discord.adminDescription',
	},
] as const

export const groupDiscordRoleAssignmentSummaryKey =
	'admin.organizations.discord.assignmentSummary' as const
