import { parseJsonResponse } from '@repo/worker-utils'

import { discordRateLimitGuard, normalizeDiscordRouteKey } from './discord-rate-limit'

/**
 * Discord API client using native fetch with rate limiting and proxy support
 */

const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface DiscordProxyConfig {
	host: string
	port: number
	username: string
	password: string
}

export interface DiscordFetchOptions {
	/** Discord API token */
	token: string
	/** Token type (Bot or Bearer) */
	tokenType?: 'Bot' | 'Bearer'
	/** Optional proxy configuration */
	proxy?: DiscordProxyConfig
	/** Maximum number of retries on rate limit (default: 3) */
	maxRetries?: number
}

export class DiscordRateLimitError extends Error {
	constructor(
		public retryAfterMs: number,
		message?: string
	) {
		super(message || `Rate limited, retry after ${retryAfterMs}ms`)
		this.name = 'DiscordRateLimitError'
	}
}

export class DiscordAPIError extends Error {
	constructor(
		public status: number,
		public body: unknown,
		message?: string
	) {
		super(message || `Discord API error: ${status}`)
		this.name = 'DiscordAPIError'
	}
}

export class DiscordFetch {
	private readonly token: string
	private readonly tokenType: 'Bot' | 'Bearer'
	private readonly proxyUrl?: string
	private readonly maxRetries: number

	constructor(options: DiscordFetchOptions) {
		this.token = options.token
		this.tokenType = options.tokenType ?? 'Bot'
		this.maxRetries = options.maxRetries ?? 3

		if (options.proxy) {
			const { host, port, username, password } = options.proxy
			this.proxyUrl = `https://${username}:${password}@${host}:${port}`
		}
	}

	/**
	 * Make a request to the Discord API with automatic rate limit handling
	 */
	async request<T>(route: string, options?: RequestInit): Promise<T> {
		let retries = 0
		const routeKey = normalizeDiscordRouteKey(`${DISCORD_API_BASE}${route}`, options?.method)

		while (retries <= this.maxRetries) {
			await discordRateLimitGuard.wait(routeKey)
			const fetchOptions: RequestInit & { proxy?: string } = {
				...options,
				headers: {
					Authorization: `${this.tokenType} ${this.token}`,
					'Content-Type': 'application/json',
					...options?.headers,
				},
			}

			// Add proxy if configured (Cloudflare Workers extension)
			if (this.proxyUrl) {
				;(fetchOptions as Record<string, unknown>).proxy = this.proxyUrl
			}

			const response = await fetch(`${DISCORD_API_BASE}${route}`, fetchOptions)
			const observation = await discordRateLimitGuard.observe(routeKey, response)

			// Handle rate limiting
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

				if (retries >= this.maxRetries) {
					throw new DiscordRateLimitError(waitMs, 'Max retries exceeded on rate limit')
				}

				await this.sleep(waitMs)
				retries++
				continue
			}

			// Handle errors
			if (!response.ok) {
				const body = await parseJsonResponse<unknown>(response, {
					context: `Discord API error for ${route}`,
					allowEmpty: true,
				}).catch(() => ({ message: 'Unknown error' }))
				const error = new DiscordAPIError(response.status, body)
				// Add status as a property for backward compatibility
				;(error as any).status = response.status
				throw error
			}

			// Handle empty responses (204 No Content)
			if (response.status === 204) {
				return {} as T
			}

			return parseJsonResponse<T>(response, { context: `Discord API response for ${route}` })
		}

		// This shouldn't be reached, but TypeScript needs it
		throw new DiscordRateLimitError(0, 'Unexpected loop exit')
	}

	/**
	 * GET request
	 */
	async get<T>(route: string): Promise<T> {
		return this.request<T>(route, { method: 'GET' })
	}

	/**
	 * POST request
	 */
	async post<T>(route: string, body?: unknown): Promise<T> {
		return this.request<T>(route, {
			method: 'POST',
			body: body ? JSON.stringify(body) : undefined,
		})
	}

	/**
	 * PUT request
	 */
	async put<T>(route: string, body?: unknown): Promise<T> {
		return this.request<T>(route, {
			method: 'PUT',
			body: body ? JSON.stringify(body) : undefined,
		})
	}

	/**
	 * PATCH request
	 */
	async patch<T>(route: string, body?: unknown): Promise<T> {
		return this.request<T>(route, {
			method: 'PATCH',
			body: body ? JSON.stringify(body) : undefined,
		})
	}

	/**
	 * DELETE request
	 */
	async delete<T>(route: string): Promise<T> {
		return this.request<T>(route, { method: 'DELETE' })
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
