import { generateShardKey } from '@repo/hazmat'
import { logger } from '@repo/hono-helpers'
import {
	DISCORD_EXCLUDED_NITRO_BOOSTER_ROLE_ID,
	discordRateLimitGuard,
	normalizeDiscordRouteKey,
} from '@repo/discord'
import { parseJsonResponse } from '@repo/worker-utils'

import type {
	APIGuildMember,
	APIRole,
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
function getDiscordProxyUrl(env: Env): string | null {
	const host = env.DISCORD_PROXY_HOST?.trim()
	const username = env.DISCORD_PROXY_USERNAME?.trim()
	const password = env.DISCORD_PROXY_PASSWORD?.trim()
	const portStart = Number(env.DISCORD_PROXY_PORT_START)
	const portCount = Number(env.DISCORD_PROXY_PORT_COUNT)

	const hasValidPortRange =
		Number.isInteger(portStart) && Number.isInteger(portCount) && portCount > 0
	const hasCredentials = Boolean(host && username && password)

	if (!hasValidPortRange || !hasCredentials) {
		logger.warn(
			'[DiscordBotService] Proxy config invalid or incomplete, using direct Discord API',
			{
				hasHost: Boolean(host),
				hasUsername: Boolean(username),
				hasPassword: Boolean(password),
				portStartRaw: env.DISCORD_PROXY_PORT_START,
				portCountRaw: env.DISCORD_PROXY_PORT_COUNT,
			}
		)
		return null
	}

	const portEnd = portStart + portCount - 1
	const port = generateShardKey(portStart, portEnd)
	return `https://${username}:${password}@${host}:${port}`
}

/**
 * Helper to sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

const MAX_RETRIES = 3
const EXCLUDED_ROLE_IDS = new Set([DISCORD_EXCLUDED_NITRO_BOOSTER_ROLE_ID])

/**
 * Make a fetch request with automatic rate limit retry handling
 * Exported for use by other Discord-related code
 */
export async function fetchWithRetry(
	url: string,
	options: RequestInit & { proxy?: string },
	maxRetries: number = MAX_RETRIES
): Promise<Response> {
	let retries = 0
	const routeKey = normalizeDiscordRouteKey(url, options.method)

	while (retries <= maxRetries) {
		await discordRateLimitGuard.wait(routeKey)
		const response = await fetch(url, options)
		const observation = await discordRateLimitGuard.observe(routeKey, response)

		// Handle rate limiting with retry
		if (response.status === 429) {
			const waitMs = observation?.retryAfterMs ?? Math.pow(2, retries) * 1000

			if (observation?.retryAfterMs === null || observation?.retryAfterMs === undefined) {
				discordRateLimitGuard.record(routeKey, {
					bucket: observation?.bucket ?? null,
					global: observation?.global ?? false,
					remaining: observation?.remaining ?? null,
					resetAfterMs: null,
					retryAfterMs: waitMs,
					scope: observation?.scope ?? null,
				})
			}

			logger.warn('[Discord] Rate limited, waiting before retry', {
				url,
				retryAfter: waitMs,
				routeKey,
				bucket: observation?.bucket ?? null,
				scope: observation?.scope ?? null,
				global: observation?.global ?? false,
				attempt: retries + 1,
				maxRetries,
			})

			if (retries >= maxRetries) {
				// Return the 429 response after max retries exhausted
				return response
			}

			await sleep(waitMs)
			retries++
			continue
		}

		return response
	}

	// Shouldn't reach here, but TypeScript needs it
	throw new Error('Unexpected loop exit in fetchWithRetry')
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
			const response = await fetchWithRetry(url, {
				method: 'GET',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
				},
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (response.status === 404) {
				// User is not a member
				return null
			}

			if (!response.ok) {
				const errorData = await parseJsonResponse(response, {
					context: `Discord getGuildMember error for ${url}`,
					allowEmpty: true,
				}).catch(() => ({}))
				throw new DiscordAPIError(response.status, errorData)
			}

			return await parseJsonResponse<RESTGetAPIGuildMemberResult>(response, {
				context: `Discord getGuildMember response for ${url}`,
			})
		} catch (error) {
			if (error instanceof DiscordAPIError && error.status === 404) {
				return null
			}
			throw error
		}
	}

	/**
	 * Get all roles for a guild
	 * Uses the "Get Guild Roles" endpoint
	 *
	 * @param guildId - Discord guild/server ID
	 * @returns Array of guild roles with ID and name
	 */
	async getGuildRoles(guildId: string): Promise<Array<{ id: string; name: string }>> {
		const proxyUrl = getDiscordProxyUrl(this.env)
		const url = `${this.baseUrl}/guilds/${guildId}/roles`
		const response = await fetchWithRetry(url, {
			method: 'GET',
			headers: {
				Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
			},
			...(proxyUrl ? { proxy: proxyUrl } : {}),
		})

		if (!response.ok) {
			const errorData = await parseJsonResponse(response, {
				context: `Discord getGuildRoles error for ${url}`,
				allowEmpty: true,
			}).catch(() => ({}))
			throw new DiscordAPIError(response.status, errorData)
		}

		const roles = await parseJsonResponse<APIRole[]>(response, {
			context: `Discord getGuildRoles response for ${url}`,
		})
		return roles.map((role) => ({ id: role.id, name: role.name }))
	}

	/**
	 * List members for a guild (paged).
	 * Uses GET /guilds/{guildId}/members with bot authorization.
	 */
	async listGuildMembers(
		guildId: string,
		options?: {
			limit?: number
			afterDiscordUserId?: string
		}
	): Promise<APIGuildMember[]> {
		const proxyUrl = getDiscordProxyUrl(this.env)
		const params = new URLSearchParams()
		params.set('limit', String(Math.min(Math.max(options?.limit ?? 200, 1), 1000)))
		if (options?.afterDiscordUserId) {
			params.set('after', options.afterDiscordUserId)
		}
		const url = `${this.baseUrl}/guilds/${guildId}/members?${params.toString()}`
		const response = await fetchWithRetry(url, {
			method: 'GET',
			headers: {
				Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
			},
			...(proxyUrl ? { proxy: proxyUrl } : {}),
		})

		if (!response.ok) {
			const errorData = await parseJsonResponse(response, {
				context: `Discord getGuildMembers error for ${url}`,
				allowEmpty: true,
			}).catch(() => ({}))
			throw new DiscordAPIError(response.status, errorData)
		}

		return await parseJsonResponse<APIGuildMember[]>(response, {
			context: `Discord getGuildMembers response for ${url}`,
		})
	}

	/**
	 * Remove a user from a Discord guild/server
	 * Uses the "Remove Guild Member" endpoint
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @returns Success status
	 */
	async removeGuildMember(
		guildId: string,
		userId: string
	): Promise<{
		success: boolean
		errorMessage?: string
	}> {
		try {
			const proxyUrl = getDiscordProxyUrl(this.env)

			const url = `${this.baseUrl}/guilds/${guildId}/members/${userId}`
			const response = await fetchWithRetry(url, {
				method: 'DELETE',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
				},
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (response.status === 404) {
				// User was not a member
				return { success: true }
			}

			if (!response.ok) {
				const errorData = await parseJsonResponse(response, {
					context: `Discord addRoleToMember error for ${url}`,
					allowEmpty: true,
				}).catch(() => ({}))
				throw new DiscordAPIError(response.status, errorData)
			}

			logger.info('[DiscordBot] Successfully removed user from guild', {
				guildId,
				userId,
			})

			return { success: true }
		} catch (error) {
			if (error instanceof DiscordAPIError) {
				logger.error('[DiscordBot] Discord API error removing member', {
					guildId,
					userId,
					status: error.status,
					code: error.code,
					message: error.message,
				})

				if (error.status === 403) {
					return {
						success: false,
						errorMessage: 'Bot lacks KICK_MEMBERS permission',
					}
				}

				return {
					success: false,
					errorMessage: `Discord API error: ${error.data?.message ?? error.message}`,
				}
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error('[DiscordBot] Unexpected error removing member', {
				guildId,
				userId,
				error: errorMessage,
			})

			return {
				success: false,
				errorMessage: `Failed to remove member: ${errorMessage}`,
			}
		}
	}

	/**
	 * Ban a user from a Discord guild/server
	 * Uses the "Create Guild Ban" endpoint
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @param reason - Optional audit log reason
	 * @returns Success status
	 */
	async banGuildMember(
		guildId: string,
		userId: string,
		reason?: string
	): Promise<{
		success: boolean
		errorMessage?: string
	}> {
		try {
			const proxyUrl = getDiscordProxyUrl(this.env)

			const url = `${this.baseUrl}/guilds/${guildId}/bans/${userId}`
			const response = await fetchWithRetry(url, {
				method: 'PUT',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					...(reason ? { 'X-Audit-Log-Reason': encodeURIComponent(reason.slice(0, 512)) } : {}),
				},
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (response.status === 204 || response.status === 201) {
				return { success: true }
			}

			if (!response.ok) {
				const errorData = await parseJsonResponse(response, {
					context: `Discord removeRoleFromMember error for ${url}`,
					allowEmpty: true,
				}).catch(() => ({}))
				throw new DiscordAPIError(response.status, errorData)
			}

			return { success: true }
		} catch (error) {
			if (error instanceof DiscordAPIError) {
				logger.error('[DiscordBot] Discord API error banning member', {
					guildId,
					userId,
					status: error.status,
					code: error.code,
					message: error.message,
				})

				if (error.status === 403) {
					return {
						success: false,
						errorMessage: 'Bot lacks BAN_MEMBERS permission',
					}
				}

				return {
					success: false,
					errorMessage: `Discord API error: ${error.data?.message ?? error.message}`,
				}
			}

			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error('[DiscordBot] Unexpected error banning member', {
				guildId,
				userId,
				error: errorMessage,
			})

			return {
				success: false,
				errorMessage: `Failed to ban member: ${errorMessage}`,
			}
		}
	}

	/**
	 * Update guild member roles and/or nickname
	 * Uses the "Modify Guild Member" endpoint
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @param roleIds - Array of role IDs to set (replaces current roles)
	 * @param nickname - Optional nickname to set for the user in this guild
	 * @returns Success status
	 */
	async updateGuildMemberRoles(
		guildId: string,
		userId: string,
		roleIds: string[],
		nickname?: string
	): Promise<{
		success: boolean
		errorMessage?: string
	}> {
		let sanitizedRoleIds = roleIds
		try {
			const proxyUrl = getDiscordProxyUrl(this.env)

			try {
				const guildRoles = await this.fetchGuildRolesRaw(guildId)
				const blockedRoleIds = new Set(
					guildRoles
						.filter(
							(role) =>
								role.managed ||
								Boolean(role.tags?.premium_subscriber) ||
								EXCLUDED_ROLE_IDS.has(role.id)
						)
						.map((role) => role.id)
				)
				if (blockedRoleIds.size > 0) {
					// Preserve blocked/unassignable roles from current member role state so we never attempt
					// to strip them (e.g. Nitro Booster, managed integration roles) during full replacements.
					const currentMember = await this.getGuildMember(guildId, userId)
					const preservedBlockedRoles = (currentMember?.roles ?? []).filter((roleId) =>
						blockedRoleIds.has(roleId)
					)
					const requestedAssignableRoles = roleIds.filter((roleId) => !blockedRoleIds.has(roleId))
					sanitizedRoleIds = [...new Set([...requestedAssignableRoles, ...preservedBlockedRoles])]
					if (
						sanitizedRoleIds.length !== roleIds.length ||
						preservedBlockedRoles.length > 0
					) {
						logger.warn('[DiscordBot] Filtered unassignable roles from member update payload', {
							guildId,
							userId,
							filteredCount: roleIds.filter((roleId) => blockedRoleIds.has(roleId)).length,
							preservedBlockedCount: preservedBlockedRoles.length,
						})
					}
				}
			} catch (error) {
				logger.warn('[DiscordBot] Failed to fetch roles for payload sanitization; continuing', {
					guildId,
					userId,
					error: error instanceof Error ? error.message : String(error),
				})
			}

			const url = `${this.baseUrl}/guilds/${guildId}/members/${userId}`
			const body = {
				roles: sanitizedRoleIds,
				...(nickname !== undefined && { nick: nickname }),
			}

			logger.info('[DiscordBot] Updating guild member', {
				guildId,
				userId,
				roleCount: sanitizedRoleIds.length,
				hasNickname: nickname !== undefined,
				nickname: nickname ?? null,
			})

			const response = await fetchWithRetry(url, {
				method: 'PATCH',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			if (!response.ok) {
				const errorData = await parseJsonResponse(response, {
					context: `Discord patchGuildMember error for ${url}`,
					allowEmpty: true,
				}).catch(() => ({}))
				throw new DiscordAPIError(response.status, errorData)
			}

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
					try {
						const [guildRoles, targetMember, botMember] = await Promise.all([
							this.fetchGuildRolesRaw(guildId),
							this.getGuildMember(guildId, userId),
							this.getGuildMember(guildId, this.env.DISCORD_CLIENT_ID),
						])

						const roleMap = new Map(guildRoles.map((role) => [role.id, role]))
						const getTopPosition = (ids: string[]) =>
							ids.reduce((max, id) => {
								const role = roleMap.get(id)
								return role && typeof role.position === 'number' ? Math.max(max, role.position) : max
							}, -1)
						const toRoleDiagnostics = (ids: string[]) =>
							ids.map((id) => {
								const role = roleMap.get(id)
								return {
									id,
									name: role?.name ?? 'unknown',
									position: role?.position ?? null,
									managed: role?.managed ?? null,
									premiumSubscriber: Boolean(role?.tags?.premium_subscriber),
								}
							})

						const botRoleIds = botMember?.roles ?? []
						const targetRoleIds = targetMember?.roles ?? []
						const botTopRolePosition = getTopPosition(botRoleIds)
						const targetTopRolePosition = getTopPosition(targetRoleIds)
						const attemptedRoleDiagnostics = toRoleDiagnostics(sanitizedRoleIds)
						const highestAttemptedRolePosition = getTopPosition(sanitizedRoleIds)

						logger.error('[DiscordBot] Role update 403 diagnostics', {
							guildId,
							userId,
							apiCode: error.code,
							apiMessage: error.data?.message ?? error.message,
							botUserId: this.env.DISCORD_CLIENT_ID,
							botRoleIds,
							botTopRolePosition,
							targetRoleIds,
							targetTopRolePosition,
							requestedRoleIds: roleIds,
							sanitizedRoleIds,
							highestAttemptedRolePosition,
							attemptedRoleDiagnostics,
							botCanManageTargetMember:
								botTopRolePosition > -1 && targetTopRolePosition > -1
									? botTopRolePosition > targetTopRolePosition
									: null,
							botCanManageAllAttemptedRoles:
								botTopRolePosition > -1 && highestAttemptedRolePosition > -1
									? botTopRolePosition > highestAttemptedRolePosition
									: null,
						})
					} catch (diagnosticError) {
						logger.warn('[DiscordBot] Failed to gather 403 role diagnostics', {
							guildId,
							userId,
							error:
								diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
						})
					}

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

	private async fetchGuildRolesRaw(guildId: string): Promise<APIRole[]> {
		const proxyUrl = getDiscordProxyUrl(this.env)
		const url = `${this.baseUrl}/guilds/${guildId}/roles`
		const response = await fetchWithRetry(url, {
			method: 'GET',
			headers: {
				Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
			},
			...(proxyUrl ? { proxy: proxyUrl } : {}),
		})

		if (!response.ok) {
			const errorData = await parseJsonResponse(response, {
				context: `Discord getRolesByIds error for ${url}`,
				allowEmpty: true,
			}).catch(() => ({}))
			throw new DiscordAPIError(response.status, errorData)
		}

		return await parseJsonResponse<APIRole[]>(response, {
			context: `Discord getRolesByIds response for ${url}`,
		})
	}

	/**
	 * Add a user to a Discord guild/server
	 * Uses the "Add Guild Member" endpoint with user's OAuth token
	 *
	 * @param guildId - Discord guild/server ID
	 * @param userId - Discord user ID
	 * @param accessToken - User's OAuth access token
	 * @param roleIds - Optional array of role IDs to assign to the user
	 * @param nickname - Optional nickname to set for the user in this guild
	 * @returns Success status and details
	 */
	async addGuildMember(
		guildId: string,
		userId: string,
		accessToken: string,
		roleIds?: string[],
		nickname?: string
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
				...(nickname && { nick: nickname }),
			}

			// Make API call to add user to guild
			// PUT /guilds/{guild.id}/members/{user.id}
			const url = `${this.baseUrl}/guilds/${guildId}/members/${userId}`
			const response = await fetchWithRetry(url, {
				method: 'PUT',
				headers: {
					Authorization: `Bot ${this.env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(body),
				...(proxyUrl ? { proxy: proxyUrl } : {}),
			})

			// 204 No Content = user was already a member
			if (response.status === 204) {
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
						const updateResult = await this.updateGuildMemberRoles(
							guildId,
							userId,
							mergedRoleIds,
							nickname
						)

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
					} else if (nickname) {
						// No new roles to add, but update nickname if provided
						const updateResult = await this.updateGuildMemberRoles(
							guildId,
							userId,
							currentRoleIds,
							nickname
						)

						if (!updateResult.success) {
							logger.warn('[DiscordBot] Failed to update nickname for existing member', {
								guildId,
								userId,
								error: updateResult.errorMessage,
							})
						}
					}
				}

				return {
					success: true,
					alreadyMember: true,
				}
			}

			// 201 Created or 200 OK = user added successfully
			if (response.ok) {
				const result = await parseJsonResponse<RESTGetAPIGuildMemberResult>(response, {
					context: `Discord fetchMemberWithRetry response for ${url}`,
				})

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
			const errorData = await parseJsonResponse(response, {
				context: `Discord fetchMemberWithRetry error for ${url}`,
				allowEmpty: true,
			}).catch(() => ({}))
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
