import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../../db'
import { discordUsers } from '../../db/schema'

import type { DiscordGateway } from '../types'
import type { DiscordGatewayContext, DiscordGatewayEventHandler, DiscordGatewayGuildMemberAddPayload } from '../types'

function resolveDiscordUserId(payload: DiscordGatewayGuildMemberAddPayload): string | null {
	return payload.member?.user?.id ?? payload.user?.id ?? null
}

function isBotAccount(payload: DiscordGatewayGuildMemberAddPayload): boolean {
	return payload.member?.user?.bot === true || payload.user?.bot === true
}

async function syncDiscordAccess(env: DiscordGatewayContext['env'], coreUserId: string) {
	try {
		const result = await env.CORE.syncUserDiscordAccess(coreUserId)
		if (result.ok) {
			return { success: true as const, queuedFallback: false as const }
		}

		logger.warn('[DiscordGateway] Core Discord sync returned failure, queueing fallback refresh', {
			coreUserId,
			rpcRequestId: result.rpcRequestId,
			reason: result.error?.message ?? result.method,
		})

		const queueResult = await env.CORE.addPendingDiscordRefreshes([coreUserId], {
			source: 'discord-gateway-member-add',
		})

		return {
			success: false as const,
			queuedFallback: true as const,
			pendingCount: queueResult.pendingCount,
		}
	} catch (error) {
		logger.error('[DiscordGateway] Discord access sync failed, queueing fallback refresh', {
			coreUserId,
			error: error instanceof Error ? error.message : String(error),
		})

		try {
			const queueResult = await env.CORE.addPendingDiscordRefreshes([coreUserId], {
				source: 'discord-gateway-member-add',
			})

			return {
				success: false as const,
				queuedFallback: true as const,
				pendingCount: queueResult.pendingCount,
			}
		} catch (queueError) {
			logger.error('[DiscordGateway] Failed to queue fallback Discord refresh', {
				coreUserId,
				error: queueError instanceof Error ? queueError.message : String(queueError),
			})
			return {
				success: false as const,
				queuedFallback: false as const,
			}
		}
	}
}

async function isManagedGuild(env: DiscordGatewayContext['env'], guildId: string): Promise<boolean> {
	try {
		return await env.CORE.isActiveDiscordGuild(guildId)
	} catch (error) {
		logger.warn('[DiscordGateway] Failed to verify managed guild, skipping member add', {
			guildId,
			error: error instanceof Error ? error.message : String(error),
		})
		return false
	}
}

export const guildMemberAddHandler: DiscordGatewayEventHandler<DiscordGatewayGuildMemberAddPayload> =
	{
		eventName: 'GUILD_MEMBER_ADD',
		async handle(context: DiscordGatewayContext<DiscordGatewayGuildMemberAddPayload>): Promise<void> {
			const discordUserId = resolveDiscordUserId(context.payload)
			if (!discordUserId) {
				logger.debug('[DiscordGateway] Ignoring member add without Discord user id', {
					guildId: context.payload.guild_id,
					sequence: context.sequence,
				})
				return
			}

			if (isBotAccount(context.payload)) {
				logger.debug('[DiscordGateway] Ignoring bot member add', {
					guildId: context.payload.guild_id,
					discordUserId,
					sequence: context.sequence,
				})
				return
			}

			if (!(await isManagedGuild(context.env, context.payload.guild_id))) {
				logger.debug('[DiscordGateway] Ignoring member add for unmanaged guild', {
					guildId: context.payload.guild_id,
					discordUserId,
					sequence: context.sequence,
				})
				return
			}

			try {
				const gatewayStub = getStub<DiscordGateway>(context.env.DISCORD_GATEWAY, 'gateway')
				const suppression = await gatewayStub.consumeJoinSuppression({
					discordUserId,
					guildId: context.payload.guild_id,
				})

				if (suppression.suppressed) {
					logger.info('[DiscordGateway] Skipping gateway member add due to invite suppression', {
						guildId: context.payload.guild_id,
						discordUserId,
						sequence: context.sequence,
					})
					return
				}
			} catch (error) {
				logger.warn('[DiscordGateway] Failed to check join suppression, continuing with sync', {
					guildId: context.payload.guild_id,
					discordUserId,
					sequence: context.sequence,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			const db = createDb(context.env.DATABASE_URL)
			const linkedUser = await db.query.discordUsers.findFirst({
				where: eq(discordUsers.userId, discordUserId),
				columns: {
					coreUserId: true,
				},
			})

			if (!linkedUser?.coreUserId) {
				logger.debug('[DiscordGateway] Ignoring member add for unlinked Discord account', {
					guildId: context.payload.guild_id,
					discordUserId,
					sequence: context.sequence,
				})
				return
			}

			const syncResult = await syncDiscordAccess(context.env, linkedUser.coreUserId)

			logger.info('[DiscordGateway] Processed guild member add', {
				guildId: context.payload.guild_id,
				discordUserId,
				coreUserId: linkedUser.coreUserId,
				sequence: context.sequence,
				queuedFallback: syncResult.queuedFallback,
				success: syncResult.success,
			})
		},
	}
