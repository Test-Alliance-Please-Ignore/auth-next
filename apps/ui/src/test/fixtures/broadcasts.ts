import { applicant } from './applicant-workflows'

import type {
	BroadcastDelivery,
	BroadcastTarget,
	BroadcastTemplate,
	BroadcastWithDetails,
	UserPermission,
} from '@/lib/api'

export const broadcastTarget: BroadcastTarget = {
	id: 'target-original',
	name: 'Original <Target>',
	description: 'Original description',
	type: 'discord_channel',
	sendPermissionId: 'permission-send',
	managePermissionId: 'permission-manage',
	displayOrder: 0,
	config: { guildId: '123456789012345678', channelId: '234567890123456789' },
	createdBy: applicant.id,
	createdAt: '2026-09-14T08:00:00Z',
	updatedAt: '2026-09-14T08:00:00Z',
}
export const broadcastTemplate: BroadcastTemplate = {
	id: 'template-original',
	name: 'Original <Template>',
	description: null,
	targetType: 'discord_channel',
	displayOrder: 0,
	targetIds: [broadcastTarget.id],
	fieldSchema: [{ name: 'staging', label: 'Original <Staging>', type: 'text', required: true }],
	messageTemplate: '{{staging}}',
	createdBy: applicant.id,
	createdAt: broadcastTarget.createdAt,
	updatedAt: broadcastTarget.updatedAt,
}
export const broadcast: BroadcastWithDetails = {
	id: 'broadcast-original',
	templateId: broadcastTemplate.id,
	targetId: broadcastTarget.id,
	title: 'Original <Broadcast> — 원문',
	content: {
		message: 'Original **message** <t:1789380000:F> <t:1789380000:R>\n<script>raw</script>',
		staging: 'Original <Staging>',
	},
	status: 'sent',
	scheduledFor: '2026-09-14T09:00:00Z',
	sentAt: '2026-09-14T10:00:00Z',
	errorMessage: null,
	permissionId: broadcastTarget.sendPermissionId,
	createdBy: applicant.id,
	createdByCharacterName: 'Original <Pilot>',
	createdAt: broadcastTarget.createdAt,
	updatedAt: broadcastTarget.updatedAt,
	target: broadcastTarget,
	template: broadcastTemplate,
}
export const broadcastDeliveries: BroadcastDelivery[] = [
	{
		id: 'delivery-original',
		broadcastId: broadcast.id,
		targetId: broadcastTarget.id,
		status: 'sent',
		discordMessageId: '345678901234567890',
		errorMessage: null,
		sentAt: broadcast.sentAt,
		createdAt: broadcast.createdAt,
		target: broadcastTarget,
	},
	{
		id: 'delivery-failed',
		broadcastId: broadcast.id,
		targetId: 'OriginalMissingTarget',
		status: 'failed',
		discordMessageId: null,
		errorMessage: 'Original <delivery error>',
		sentAt: null,
		createdAt: broadcast.createdAt,
	},
]
export const broadcastManagePermission: UserPermission = {
	permissionId: broadcastTarget.managePermissionId,
	urn: 'urn:broadcasts:manage:test',
	name: 'Original permission',
	description: null,
	category: null,
	groupId: 'original-group',
	groupName: 'Original group',
	targetType: 'all_members',
	source: 'global',
}
