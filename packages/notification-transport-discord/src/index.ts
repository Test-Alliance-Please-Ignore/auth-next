import type {
	NotificationTransportRegistry,
	RegisterTransport,
} from '@repo/notification-transport-base'

import { DiscordChannelParams } from './schemas/channel'
import { DiscordDMParams } from './schemas/dm'
import { DiscordMessageParams } from './schemas/message'
import { DiscordWebhookParams } from './schemas/webhook'

import type { Env } from './context'

/** Single register function that registers all Discord transport types */
export const register: RegisterTransport = (registry, env) => {
	// Register Discord message transport
	registry.registerExternal('discord.message', {
		kind: 'service',
		binding: 'DISCORD_SERVICE',
		paramsSchema: DiscordMessageParams,
	})

	// Register Discord webhook transport
	registry.registerExternal('discord.webhook', {
		kind: 'service',
		binding: 'DISCORD_SERVICE',
		paramsSchema: DiscordWebhookParams,
	})

	// Register Discord DM transport
	registry.registerExternal('discord.dm', {
		kind: 'service',
		binding: 'DISCORD_SERVICE',
		paramsSchema: DiscordDMParams,
	})

	// Register Discord channel transport
	registry.registerExternal('discord.channel', {
		kind: 'service',
		binding: 'DISCORD_SERVICE',
		paramsSchema: DiscordChannelParams,
	})
}

