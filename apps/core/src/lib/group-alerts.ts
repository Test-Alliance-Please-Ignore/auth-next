import type { DiscordEmbed, MessageContent } from '@repo/discord'

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value
	}

	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function formatNote(note: string | null | undefined): string {
	if (!note || note.trim().length === 0) {
		return 'No note provided.'
	}

	return truncateText(note.trim(), 1024)
}

export interface GroupApplicationSubmittedMessageInput {
	groupId: string
	groupName: string
	applicantCharacterId: string
	applicantCharacterName: string
	applicationNote: string | null
	submittedAt: Date
}

export interface GroupInvitationMessageInput {
	groupId: string
	groupName: string
	inviterCharacterName: string
	invitationId: string
	createdAt: Date
}

export function buildGroupApplicationSubmittedMessage(
	input: GroupApplicationSubmittedMessageInput
): MessageContent {
	const groupUrl = `https://pleaseignore.app/groups/${input.groupId}`
	const applicantPortrait = `https://images.evetech.net/characters/${input.applicantCharacterId}/portrait?size=256`

	const fields: DiscordEmbed['fields'] = [
		{
			name: 'Applicant',
			value: input.applicantCharacterName,
			inline: true,
		},
		{
			name: 'Group',
			value: input.groupName,
			inline: true,
		},
		{
			name: 'Application Note',
			value: formatNote(input.applicationNote),
			inline: false,
		},
	]

	return {
		content: '',
		embeds: [
			{
				title: `New application for ${input.groupName}`,
				description: `[Review group](${groupUrl})`,
				color: 0x3b82f6,
				thumbnail: {
					url: applicantPortrait,
				},
				fields,
				footer: {
					text: 'Group application notice',
				},
				timestamp: input.submittedAt.toISOString(),
			},
		],
	}
}

export function buildGroupInvitationMessage(input: GroupInvitationMessageInput): MessageContent {
	const invitationsUrl = 'https://pleaseignore.app/invitations'

	const fields: DiscordEmbed['fields'] = [
		{
			name: 'Group',
			value: input.groupName,
			inline: true,
		},
		{
			name: 'Invited By',
			value: input.inviterCharacterName,
			inline: true,
		},
	]

	return {
		content: '',
		embeds: [
			{
				title: `You have a new invitation to ${input.groupName}`,
				description: `[View invitations](${invitationsUrl})`,
				color: 0x10b981,
				fields,
				footer: {
					text: `Invitation ${input.invitationId}`,
				},
				timestamp: input.createdAt.toISOString(),
			},
		],
	}
}
