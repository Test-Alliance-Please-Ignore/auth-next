import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { createDb } from './db'

export interface DiscordInteractionOption {
	name: string
	value?: unknown
	type?: number
	options?: DiscordInteractionOption[]
}

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	DISCORD: DurableObjectNamespace
	DISCORD_RATE_LIMITS: KVNamespace
	DISCORD_AUTHORIZE_URL: string
	DISCORD_TOKEN_URL: string
	DISCORD_TOKEN_REVOKE_URL: string
	DISCORD_CALLBACK_URL: string
	DISCORD_USER_INFO_URL: string

	DISCORD_CLIENT_ID: string
	DISCORD_CLIENT_SECRET: string
	DISCORD_BOT_TOKEN: string
	DISCORD_PUBLIC_KEY: string

	// Proxy configuration for Discord API rate limit handling
	DISCORD_PROXY_HOST: string
	DISCORD_PROXY_PORT_START: string
	DISCORD_PROXY_PORT_COUNT: string
	DISCORD_PROXY_USERNAME: string
	DISCORD_PROXY_PASSWORD: string

	LEGACY_AUTH_CLIENT_ID: string
	LEGACY_AUTH_CLIENT_SECRET: string

	ENCRYPTION_KEY: string

	// Role management configuration
	DISCORD_ROLE_ADD_ONLY_MODE: string

	// Core worker service binding for slash command execution
	CORE: Fetcher & {
		executeDiscordSlashCommand(input: {
			commandName: string
			discordUserId: string
			guildId?: string | null
			channelId?: string | null
			options?: DiscordInteractionOption[]
		}): Promise<{
			ok: boolean
			response: {
				type: number
				data?: {
					content: string
					flags?: number
				}
			}
			coreUserId: string | null
			authorized: boolean
			commandId?: string
			reason: string
		}>
	}
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
