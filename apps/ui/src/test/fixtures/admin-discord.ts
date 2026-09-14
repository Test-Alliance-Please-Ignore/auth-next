import type {
	DiscordAuditMember,
	DiscordCommand,
	DiscordCommandCategory,
	DiscordGuildAuditResponse,
	DiscordSelfAssignableRole,
	DiscordServerWithRoles,
} from '@/lib/api'

const date = '2026-01-01T12:00:00Z'
export const discordServer: DiscordServerWithRoles = {
	id: 'server-original',
	guildId: '987654321012345678',
	guildName: 'Guild <Original>',
	description: 'Original guild description',
	isActive: true,
	manageNicknames: true,
	createdBy: 'admin-original',
	createdAt: date,
	updatedAt: date,
	roles: [
		{
			id: 'managed-role-original',
			discordServerId: 'server-original',
			roleId: '876543210123456789',
			roleName: 'Role <Original>',
			description: 'Original role description',
			isActive: true,
			autoApply: true,
			createdAt: date,
			updatedAt: date,
		},
	],
}
export const discordSelfRole: DiscordSelfAssignableRole = {
	id: 'self-role-original',
	discordRoleId: 'managed-role-original',
	displayName: 'Display <Original>',
	defaultDurationSeconds: 5400,
	createdAt: date,
	updatedAt: date,
	discordRole: discordServer.roles[0],
}
export const discordCategory: DiscordCommandCategory = {
	id: 'category-original',
	name: 'Category <Original>',
	description: 'Original category description',
	sortOrder: 1234,
	createdAt: date,
	updatedAt: date,
}
export const discordCommand: DiscordCommand = {
	id: 'command-original',
	categoryId: discordCategory.id,
	name: 'original_command',
	description: 'Original command description',
	commandType: 'static_response',
	responseTemplate: 'Original **markdown** {{discordUserId}} <@123456789012345678>',
	isActive: true,
	createdBy: 'admin-original',
	createdAt: date,
	updatedAt: date,
	category: discordCategory,
	requiredPermissions: [],
	serverAttachments: [
		{
			id: 'attachment-original',
			discordServerId: discordServer.id,
			commandId: 'command-original',
			discordCommandId: '765432101234567890',
			createdBy: 'admin-original',
			createdAt: date,
			updatedAt: date,
		},
	],
	immutableAccessRequirements: [],
}
export const discordProgrammaticCommand: DiscordCommand = {
	...discordCommand,
	id: 'programmatic-original',
	name: 'original_programmatic',
	commandType: 'programmatic',
	responseTemplate: null,
	immutableAccessRequirements: ['Original code-defined requirement'],
}
export const discordAuditMember: DiscordAuditMember = {
	discordUserId: '654321012345678901',
	username: 'Username Original',
	discriminator: '0',
	displayName: 'Display <Original>',
	roleIds: ['876543210123456789'],
	linked: true,
	coreUserId: 'user-original',
	mainCharacterId: '2119123456',
	mainCharacterName: 'Pilot Original',
	hasValidToken: true,
	corporationId: '98000001',
	corporationName: 'Corporation Original',
	isInMemberCorporation: false,
	hasRoleAffiliationMismatch: true,
	unmanagedRoleCount: 1234,
}
export const discordAudit: DiscordGuildAuditResponse = {
	server: discordServer,
	tab: 'linked',
	items: [discordAuditMember],
	nextCursor: null,
	scanned: 1234,
	runId: 'run-original',
	runStatus: 'completed',
	runStartedAt: date,
	runCompletedAt: date,
	filter: 'all',
	pagination: { page: 1, pageSize: 25, totalCount: 1234, totalPages: 50 },
}
export function discordAuditCache(
	data = discordAudit,
	selectedUnlinked: Record<string, boolean> = {}
) {
	return {
		version: 1,
		selectedServerId: discordServer.id,
		entries: {
			[discordServer.id]: {
				activeServerId: discordServer.id,
				tab: data.tab,
				filter: data.filter,
				page: 1,
				pageSize: 25,
				data,
				selectedUnlinked,
				startCooldownUntil: 0,
			},
		},
	}
}
