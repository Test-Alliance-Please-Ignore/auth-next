import { REST } from '@discordjs/rest'
import { Routes } from 'discord-api-types/v10'
import { generateShardKey } from '@repo/hazmat'
import { logger } from '@repo/hono-helpers'

import type { RESTError, RESTGetAPIGuildMemberResult, RESTPutAPIGuildMemberJSONBody } from 'discord-api-types/v10'
import type { Env } from '../context'

/**
 * Generate a dynamic HTTPS proxy URL using rotating ports
 * Uses generateShardKey for cryptographically secure random port selection
 */
async function getDiscordProxyUrl(env: Env): Promise<string> {
	const portCount = Number(env.DISCORD_PROXY_PORT_COUNT)
	const portOffset = await generateShardKey(portCount)
	const port = Number(env.DISCORD_PROXY_PORT_START) + portOffset

	return `https://${env.DISCORD_PROXY_USERNAME}:${env.DISCORD_PROXY_PASSWORD}@${env.DISCORD_PROXY_HOST}:${port}`
}

/**
 * Discord Bot Service
 *
 * Handles Discord API operations using the bot token
 * Supports HTTPS proxy with dynamic port rotation for rate limit handling
 */
export class DiscordBotService {
	private rest: REST

	constructor(private env: Env) {
		this.rest = new REST({ version: '10' }).setToken(env.DISCORD_BOT_TOKEN)
	}

	/**
	 * Add a user to a Discord guild/server
	 * Uses the "Add Guild Member" endpoint with user's OAuth token
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @param accessToken - User's OAuth access token
	 * @returns Success status and details
	 */
	async addGuildMember(
		guildId: string,
		userId: string,
		accessToken: string
	): Promise<{
		success: boolean
		errorMessage?: string
		alreadyMember?: boolean
	}> {
		try {
			// Generate dynamic proxy URL for this request
			const proxyUrl = await getDiscordProxyUrl(this.env)

			// Configure REST client with proxy
			// Note: @discordjs/rest uses fetch internally, which needs proxy configuration
			// For Cloudflare Workers, we'll use a custom fetch with proxy support
			const customFetch = async (url: string, init?: RequestInit) => {
				return fetch(url, {
					...init,
					// @ts-expect-error - Cloudflare Workers supports proxy in fetch
					proxy: proxyUrl,
				})
			}

			// Override fetch for this request
			const originalFetch = globalThis.fetch
			globalThis.fetch = customFetch as typeof fetch

			try {
				// Prepare request body
				const body: RESTPutAPIGuildMemberJSONBody = {
					access_token: accessToken,
				}

				// Make API call to add user to guild
				// PUT /guilds/{guild.id}/members/{user.id}
				const result = await this.rest.put(Routes.guildMember(guildId, userId), {
					body,
				}) as RESTGetAPIGuildMemberResult | null

				// If result is null/undefined, user was already a member (204 response)
				if (!result) {
					logger.info('[DiscordBot] User already member of guild', {
						guildId,
						userId,
					})
					return {
						success: true,
						alreadyMember: true,
					}
				}

				logger.info('[DiscordBot] Successfully added user to guild', {
					guildId,
					userId,
					nickname: result.nick,
				})

				return {
					success: true,
					alreadyMember: false,
				}
			} finally {
				// Restore original fetch
				globalThis.fetch = originalFetch
			}
		} catch (error) {
			// Handle Discord API errors
			if (this.isRESTError(error)) {
				const discordError = error as RESTError & { status?: number; rawError?: { httpStatus?: number } }

				// Try to get HTTP status from various possible locations
				const httpStatus =
					discordError.status ??
					discordError.rawError?.httpStatus ??
					((error as any).httpStatus as number | undefined)

				logger.error('[DiscordBot] Discord API error adding user to guild', {
					guildId,
					userId,
					status: httpStatus,
					code: discordError.code,
					message: discordError.message,
				})

				// Check for specific error codes
				if (discordError.code === 30001) {
					return {
						success: false,
						errorMessage: 'Guild has reached maximum member limit',
					}
				}

				if (httpStatus === 403) {
					return {
						success: false,
						errorMessage: 'Bot lacks permission to add members to this guild',
					}
				}

				if (httpStatus === 404) {
					return {
						success: false,
						errorMessage: 'Guild not found',
					}
				}

				return {
					success: false,
					errorMessage: `Discord API error: ${discordError.message}`,
				}
			}

			// Handle other errors
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error('[DiscordBot] Unexpected error adding user to guild', {
				guildId,
				userId,
				error: errorMessage,
			})

			return {
				success: false,
				errorMessage: `Failed to add user to guild: ${errorMessage}`,
			}
		}
	}

	/**
	 * Type guard to check if error is a Discord REST error
	 */
	private isRESTError(error: unknown): error is RESTError {
		return (
			typeof error === 'object' &&
			error !== null &&
			'status' in error &&
			'code' in error &&
			'message' in error
		)
	}
}
