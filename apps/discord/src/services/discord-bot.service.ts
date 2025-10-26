import { generateShardKey } from '@repo/hazmat'
import { logger } from '@repo/hono-helpers'

import type {
	RESTGetAPIGuildMemberResult,
	RESTPutAPIGuildMemberJSONBody,
} from 'discord-api-types/v10'
import type { Env } from '../context'

/**
 * Discord API Error
 */
class DiscordAPIError extends Error {
	constructor(
		public status: number,
		public data: any
	) {
		super(`Discord API error: ${status}`)
		this.name = 'DiscordAPIError'
	}

	get code(): number | undefined {
		return this.data?.code
	}
}

/**
 * Generate a dynamic HTTPS proxy URL using rotating ports
 * Uses generateShardKey for cryptographically secure random port selection
 */
function getDiscordProxyUrl(env: Env): string {
	const portStart = Number(env.DISCORD_PROXY_PORT_START)
	const portCount = Number(env.DISCORD_PROXY_PORT_COUNT)
	const portEnd = portStart + portCount - 1
	const port = generateShardKey(portStart, portEnd)

	return `https://${env.DISCORD_PROXY_USERNAME}:${env.DISCORD_PROXY_PASSWORD}@${env.DISCORD_PROXY_HOST}:${port}`
}

/**
 * Discord Bot Service
 *
 * Handles Discord API operations using the bot token
 * Supports HTTPS proxy with dynamic port rotation for rate limit handling
 */
export class DiscordBotService {
	private readonly baseUrl = 'https://discord.com/api/v10'

	constructor(private env: Env) {}

	/**
	 * Get guild member information
	 * Uses the "Get Guild Member" endpoint
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @returns Member data including current roles, or null if not a member
	 */
	async getGuildMember(
		guildId: string,
		userId: string
	): Promise<RESTGetAPIGuildMemberResult | null> {
		try {
			const proxyUrl = getDiscordProxyUrl(this.env)

			const url = `${this.baseUrl}/guilds/${guildId}/members/${userId}`
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
				},
				// @ts-expect-error - Cloudflare Workers supports proxy in fetch
				proxy: proxyUrl,
			})

			if (response.status === 404) {
				// User is not a member
				return null
			}

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				throw new DiscordAPIError(response.status, errorData)
			}

			return (await response.json()) as RESTGetAPIGuildMemberResult
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				return null
			}
			throw error
		}
	}

	/**
	 * Update guild member roles
	 * Uses the "Modify Guild Member" endpoint
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @param roleIds - Array of role IDs to set (replaces current roles)
	 * @returns Success status
	 */
	async updateGuildMemberRoles(
		guildId: string,
		userId: string,
		roleIds: string[]
	): Promise<{
		success: boolean
		errorMessage?: string
	}> {
		try {
			const proxyUrl = getDiscordProxyUrl(this.env)

			const url = `${this.baseUrl}/guilds/${guildId}/members/${userId}`
			const response = await fetch(url, {
				method: 'PATCH',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					roles: roleIds,
				}),
				// @ts-expect-error - Cloudflare Workers supports proxy in fetch
				proxy: proxyUrl,
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				throw new DiscordAPIError(response.status, errorData)
			}

			logger.info('[DiscordBot] Successfully updated member roles', {
				guildId,
				userId,
				roleCount: roleIds.length,
			})

			return { success: true }
		} catch (error) {
			if (error instanceof DiscordAPIError) {
				logger.error('[DiscordBot] Discord API error updating member roles', {
					guildId,
					userId,
					status: error.status,
					code: error.code,
					message: error.message,
				})

				if (error.status === 403) {
					return {
						success: false,
						errorMessage: 'Bot lacks MANAGE_ROLES permission',
					}
				}

				return {
					success: false,
					errorMessage: `Discord API error: ${error.data?.message ?? error.message}`,
				}
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error('[DiscordBot] Unexpected error updating member roles', {
				guildId,
				userId,
				error: errorMessage,
			})

			return {
				success: false,
				errorMessage: `Failed to update member roles: ${errorMessage}`,
			}
		}
	}

	/**
	 * Add a user to a Discord guild/server
	 * Uses the "Add Guild Member" endpoint with user's OAuth token
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @param accessToken - User's OAuth access token
	 * @param roleIds - Optional array of role IDs to assign to the user
	 * @returns Success status and details
	 */
	async addGuildMember(
		guildId: string,
		userId: string,
		accessToken: string,
		roleIds?: string[]
	): Promise<{
		success: boolean
		errorMessage?: string
		alreadyMember?: boolean
		authRevoked?: boolean
	}> {
		try {
			// Generate dynamic proxy URL for this request
			const proxyUrl = getDiscordProxyUrl(this.env)

			// Prepare request body
			const body: RESTPutAPIGuildMemberJSONBody = {
				access_token: accessToken,
				...(roleIds && roleIds.length > 0 && { roles: roleIds }),
			}

			// Make API call to add user to guild
			// PUT /guilds/{guild.id}/members/{user.id}
			const url = `${this.baseUrl}/guilds/${guildId}/members/${userId}`
			const response = await fetch(url, {
				method: 'PUT',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				// @ts-expect-error - Cloudflare Workers supports proxy in fetch
				proxy: proxyUrl,
			})

			// 204 No Content = user was already a member
			if (response.status === 204) {
				logger.info('[DiscordBot] User already member of guild, updating roles', {
					guildId,
					userId,
					newRoleCount: roleIds?.length ?? 0,
				})

				// User is already a member, update their roles if needed
				if (roleIds && roleIds.length > 0) {
					// Get current member data to merge roles
					const member = await this.getGuildMember(guildId, userId)

					if (!member) {
						// This shouldn't happen since we got 204, but handle it
						logger.warn('[DiscordBot] Got 204 but member not found when fetching', {
							guildId,
							userId,
						})
						return {
							success: true,
							alreadyMember: true,
						}
					}

					// Merge current roles with new roles (smart merge - preserve existing)
					const currentRoleIds = member.roles || []
					const mergedRoleIds = [...new Set([...currentRoleIds, ...roleIds])]

					// Only update if there are new roles to add
					if (mergedRoleIds.length > currentRoleIds.length) {
						logger.info('[DiscordBot] Merging roles for existing member', {
							guildId,
							userId,
							currentRoles: currentRoleIds.length,
							newRoles: roleIds.length,
							mergedRoles: mergedRoleIds.length,
						})

						const updateResult = await this.updateGuildMemberRoles(guildId, userId, mergedRoleIds)

						if (!updateResult.success) {
							logger.warn('[DiscordBot] Failed to update roles for existing member', {
								guildId,
								userId,
								error: updateResult.errorMessage,
							})
							// Still return success since user is in the guild
							return {
								success: true,
								alreadyMember: true,
								errorMessage: `Member exists but role update failed: ${updateResult.errorMessage}`,
							}
						}

						logger.info('[DiscordBot] Successfully updated roles for existing member', {
							guildId,
							userId,
							rolesAdded: mergedRoleIds.length - currentRoleIds.length,
						})
					} else {
						logger.info('[DiscordBot] User already has all required roles', {
							guildId,
							userId,
							roleCount: currentRoleIds.length,
						})
					}
				}

				return {
					success: true,
					alreadyMember: true,
				}
			}

			// 201 Created or 200 OK = user added successfully
			if (response.ok) {
				const result = (await response.json()) as RESTGetAPIGuildMemberResult

				logger.info('[DiscordBot] Successfully added user to guild', {
					guildId,
					userId,
					nickname: result.nick,
				})

				return {
					success: true,
					alreadyMember: false,
				}
			}

			// Handle error responses
			const errorData = await response.json().catch(() => ({}))
			throw new DiscordAPIError(response.status, errorData)
		} catch (error) {
			// Handle Discord API errors
			if (error instanceof DiscordAPIError) {
				logger.error('[DiscordBot] Discord API error adding user to guild', {
					guildId,
					userId,
					status: error.status,
					code: error.code,
					message: error.message,
				})

				// Check for specific error codes
				if (error.code === 30001) {
					return {
						success: false,
						errorMessage: 'Guild has reached maximum member limit',
					}
				}

				// Error code 50025 = Missing Access (user revoked authorization)
				if (error.code === 50025) {
					logger.warn('[DiscordBot] User has revoked Discord app authorization', {
						guildId,
						userId,
						code: error.code,
					})
					return {
						success: false,
						errorMessage: 'Discord authorization revoked. Please re-link your Discord account.',
						authRevoked: true,
					}
				}

				if (error.status === 403) {
					return {
						success: false,
						errorMessage: 'Bot lacks permission to add members to this guild',
					}
				}

				if (error.status === 404) {
					return {
						success: false,
						errorMessage: 'Guild not found',
					}
				}

				return {
					success: false,
					errorMessage: `Discord API error: ${error.data?.message ?? error.message}`,
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
}
