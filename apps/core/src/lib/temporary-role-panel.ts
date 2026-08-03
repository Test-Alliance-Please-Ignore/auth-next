import { DISCORD_BUTTON_STYLE, DISCORD_COMPONENT_TYPE } from '@repo/discord'

import type { MessageContent } from '@repo/discord'

export const TEMPORARY_ROLE_PANEL_DEFAULT_TITLE = 'Temporary Roles'

export const TEMPORARY_ROLE_PANEL_DEFAULT_MESSAGE =
	'Click Join to choose a temporary role. When you are done, click Leave or use /leave to remove it.'

export const TEMPORARY_ROLE_PANEL_CUSTOM_IDS = {
	join: 'tmp-role-panel:join',
	leave: 'tmp-role-panel:leave',
} as const

const MAX_EMBED_DESCRIPTION_LENGTH = 4000
const MAX_EMBED_TITLE_LENGTH = 256

export function buildTemporaryRolePanelMessage(
	title?: string,
	description?: string
): MessageContent {
	const embedTitle = title?.trim() || TEMPORARY_ROLE_PANEL_DEFAULT_TITLE
	const message = description?.trim() || TEMPORARY_ROLE_PANEL_DEFAULT_MESSAGE
	if (embedTitle.length > MAX_EMBED_TITLE_LENGTH) {
		throw new Error('The panel title is too long for a Discord embed.')
	}
	if (message.length > MAX_EMBED_DESCRIPTION_LENGTH) {
		throw new Error('The panel description is too long for a Discord embed.')
	}

	return {
		content: '\u200b',
		embeds: [
			{
				title: embedTitle,
				description: message,
			},
		],
		components: [
			{
				type: DISCORD_COMPONENT_TYPE.ACTION_ROW,
				components: [
					{
						type: DISCORD_COMPONENT_TYPE.BUTTON,
						style: DISCORD_BUTTON_STYLE.SUCCESS,
						label: 'Join',
						custom_id: TEMPORARY_ROLE_PANEL_CUSTOM_IDS.join,
					},
					{
						type: DISCORD_COMPONENT_TYPE.BUTTON,
						style: DISCORD_BUTTON_STYLE.DANGER,
						label: 'Leave',
						custom_id: TEMPORARY_ROLE_PANEL_CUSTOM_IDS.leave,
					},
				],
			},
		],
		allowEveryone: false,
	}
}

export function parseTemporaryRolePanelAction(customId: string): 'join' | 'leave' | null {
	if (customId === TEMPORARY_ROLE_PANEL_CUSTOM_IDS.join) return 'join'
	if (customId === TEMPORARY_ROLE_PANEL_CUSTOM_IDS.leave) return 'leave'
	return null
}
