import { DiscordChannelTransport } from './transports/channel'
import { DiscordDMTransport } from './transports/dm'
import { DiscordMessageTransport } from './transports/message'
import { DiscordWebhookTransport } from './transports/webhook'

import type { RegisterTransport } from '@repo/notification-transport-base'

export type DiscordNotificationTransportEnv = {
	DISCORD_BOT_TOKEN: string
}

/** Single register function that registers all Discord transport types */
export const register: RegisterTransport<DiscordNotificationTransportEnv> = (registry, env) => {
	// Register Discord message transport
	registry.register(new DiscordMessageTransport(env.DISCORD_BOT_TOKEN))

	// Register Discord channel transport
	registry.register(new DiscordChannelTransport(env.DISCORD_BOT_TOKEN))

	// Register Discord DM transport
	registry.register(new DiscordDMTransport(env.DISCORD_BOT_TOKEN))

	// Register Discord webhook transport (no bot token needed)
	registry.register(new DiscordWebhookTransport())
}
