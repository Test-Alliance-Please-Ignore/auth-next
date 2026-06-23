import { guildMemberAddHandler } from './handlers/guild-member-add'
import type { DiscordGatewayEventHandler } from './types'

export const defaultDiscordGatewayHandlers: DiscordGatewayEventHandler[] = [guildMemberAddHandler]
