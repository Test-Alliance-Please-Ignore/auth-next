import type { DiscordSlashCommandDefinition } from '@repo/discord'
import type { DiscordCommandOptionAlias } from '../discord-command-registry.service'

export interface ProgrammaticCommandResponse {
	type: number
	data?: {
		content: string
		flags?: number
	}
}

export interface ProgrammaticCommandDefinition {
	name: string
	description: string
	options?: DiscordSlashCommandDefinition['options']
	optionAliases?: DiscordCommandOptionAlias[]
	handler: (input: { optionValues: Record<string, string> }) => ProgrammaticCommandResponse
}

export function commandResponse(content: string): ProgrammaticCommandResponse {
	return {
		type: 4,
		data: { content },
	}
}
