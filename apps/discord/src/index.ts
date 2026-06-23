import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { getStub } from '@repo/do-utils'
import { useWorkersLogger } from 'workers-tagged-logger'
import { z } from 'zod'

import { logger, withNotFound, withOnError, withSentry } from '@repo/hono-helpers'

import { DiscordDO, DiscordGatewayDO } from './durable-object'
import type { DiscordGateway } from './gateway/types'
import * as discordService from './services/discord.service'

import type { App, DiscordInteractionOption } from './context'

const DISCORD_INTERACTION_PING = 1
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2
const DISCORD_EPHEMERAL_FLAG = 1 << 6
const DISCORD_REPLAY_WINDOW_SECONDS = 5 * 60

interface DiscordInteractionPayload {
	id: string
	type: number
	guild_id?: string
	channel_id?: string
	user?: {
		id: string
	}
	member?: {
		user?: {
			id: string
		}
		permissions?: string
	}
	data?: {
		name?: string
		options?: DiscordInteractionOption[]
	}
}

function hexToBytes(hex: string): Uint8Array | null {
	const normalized = hex.trim()
	if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
		return null
	}

	const out = new Uint8Array(normalized.length / 2)
	for (let i = 0; i < normalized.length; i += 2) {
		out[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16)
	}
	return out
}

async function verifyDiscordInteractionSignature(
	publicKeyHex: string,
	timestamp: string,
	rawBody: string,
	signatureHex: string
): Promise<boolean> {
	const publicKey = hexToBytes(publicKeyHex)
	const signature = hexToBytes(signatureHex)
	if (!publicKey || !signature) {
		return false
	}

	try {
		const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, [
			'verify',
		])
		const message = new TextEncoder().encode(`${timestamp}${rawBody}`)
		return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message)
	} catch {
		return false
	}
}

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME ?? 'discord', {
				environment: c.env.ENVIRONMENT ?? 'development',
				release: c.env.SENTRY_RELEASE ?? 'unknown',
			})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('Discord Durable Object Worker')
	})

	.post('/api/discord/interactions', async (c) => {
		const requestId = crypto.randomUUID()
		const startedAt = Date.now()

		const signature = c.req.header('X-Signature-Ed25519')
		const timestamp = c.req.header('X-Signature-Timestamp')
		if (!signature || !timestamp) {
			logger.warn('[DiscordInteractions] Missing signature headers', { requestId })
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const tsSeconds = Number.parseInt(timestamp, 10)
		if (!Number.isFinite(tsSeconds)) {
			logger.warn('[DiscordInteractions] Invalid timestamp header', { requestId, timestamp })
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const nowSeconds = Math.floor(Date.now() / 1000)
		if (Math.abs(nowSeconds - tsSeconds) > DISCORD_REPLAY_WINDOW_SECONDS) {
			logger.warn('[DiscordInteractions] Replay window validation failed', {
				requestId,
				timestamp: tsSeconds,
				nowSeconds,
			})
			return c.json({ error: 'Unauthorized' }, 401)
		}

		const rawBody = await c.req.raw.text()
		const isValidSignature = await verifyDiscordInteractionSignature(
			c.env.DISCORD_PUBLIC_KEY,
			timestamp,
			rawBody,
			signature
		)
		if (!isValidSignature) {
			logger.warn('[DiscordInteractions] Signature verification failed', { requestId })
			return c.json({ error: 'Unauthorized' }, 401)
		}

		let interaction: DiscordInteractionPayload
		try {
			interaction = JSON.parse(rawBody) as DiscordInteractionPayload
		} catch {
			logger.warn('[DiscordInteractions] Invalid JSON payload', { requestId })
			return c.json({ error: 'Invalid interaction payload' }, 400)
		}

		if (interaction.type === DISCORD_INTERACTION_PING) {
			logger.info('[DiscordInteractions] Ping interaction', { requestId, interactionId: interaction.id })
			return c.json({ type: DISCORD_INTERACTION_PING })
		}

		if (interaction.type !== DISCORD_INTERACTION_APPLICATION_COMMAND || !interaction.data?.name) {
			logger.warn('[DiscordInteractions] Unsupported interaction type', {
				requestId,
				interactionId: interaction.id,
				interactionType: interaction.type,
			})
			return c.json({
				type: 4,
				data: {
					content: 'Unsupported interaction type.',
					flags: DISCORD_EPHEMERAL_FLAG,
				},
			})
		}

		const commandName = interaction.data.name
		const discordUserId = interaction.member?.user?.id ?? interaction.user?.id ?? null
		const guildId = interaction.guild_id ?? null
		const channelId = interaction.channel_id ?? null

		logger.info('[DiscordInteractions] Received slash command', {
			requestId,
			interactionId: interaction.id,
			commandName,
			discordUserId,
			guildId,
			channelId,
		})

		if (!discordUserId) {
			return c.json({
				type: 4,
				data: {
					content: 'Unable to resolve Discord user for this interaction.',
					flags: DISCORD_EPHEMERAL_FLAG,
				},
			})
		}

		try {
			const execution = await c.env.CORE.executeDiscordSlashCommand({
				commandName,
				discordUserId,
				guildId,
				channelId,
				options: interaction.data.options ?? [],
			})

			logger.info('[DiscordInteractions] Slash command handled', {
				requestId,
				interactionId: interaction.id,
				commandName,
				discordUserId,
				guildId,
				coreUserId: execution.coreUserId,
				authorized: execution.authorized,
				reason: execution.reason,
				durationMs: Date.now() - startedAt,
			})

			return c.json(execution.response)
		} catch (error) {
			logger.error('[DiscordInteractions] Slash command execution failed', {
				requestId,
				interactionId: interaction.id,
				commandName,
				discordUserId,
				guildId,
				error: error instanceof Error ? error.message : String(error),
				durationMs: Date.now() - startedAt,
			})
			return c.json({
				type: 4,
				data: {
					content: 'Command execution failed. Please try again later.',
					flags: DISCORD_EPHEMERAL_FLAG,
				},
			})
		}
	})

	/**
	 * Store Discord tokens (PKCE flow)
	 * POST /discord/auth/store-tokens
	 * Body: { userId, username, discriminator, scopes, accessToken, refreshToken, expiresAt, coreUserId }
	 * Returns: { success: boolean }
	 */
	.post(
		'/discord/auth/store-tokens',
		zValidator(
			'json',
			z.object({
				userId: z.string(),
				username: z.string(),
				discriminator: z.string(),
				scopes: z.array(z.string()),
				accessToken: z.string(),
				refreshToken: z.string(),
				expiresAt: z.string(),
				coreUserId: z.string().uuid(),
			})
		),
		async (c) => {
			const {
				userId,
				username,
				discriminator,
				scopes,
				accessToken,
				refreshToken,
				expiresAt,
				coreUserId,
			} = c.req.valid('json')
			const result = await discordService.storeTokens(
				c.env,
				userId,
				username,
				discriminator,
				scopes,
				accessToken,
				refreshToken,
				new Date(expiresAt),
				coreUserId
			)
			return c.json({ success: result })
		}
	)

	/**
	 * Get Discord profile by core user ID
	 * GET /discord/profile/:coreUserId
	 * Returns: { userId: string, username: string, discriminator: string, scopes: string[] } | null
	 */
	.get('/discord/profile/:coreUserId', async (c) => {
		const coreUserId = c.req.param('coreUserId')
		const profile = await discordService.getProfile(c.env, coreUserId)

		if (!profile) {
			return c.json({ error: 'Discord profile not found' }, 404)
		}

		return c.json(profile)
	})

	/**
	 * Refresh Discord OAuth token
	 * POST /discord/refresh/:coreUserId
	 * Returns: { success: boolean }
	 */
	.post('/discord/refresh/:coreUserId', async (c) => {
		const coreUserId = c.req.param('coreUserId')
		const success = await discordService.refreshToken(c.env, coreUserId)

		return c.json({ success })
	})

const sentryApp = withSentry(app)

async function scheduled(event: ScheduledEvent, env: App['Bindings'], _ctx: ExecutionContext): Promise<void> {
	try {
		const gatewayStub = getStub<DiscordGateway>(env.DISCORD_GATEWAY, 'gateway')
		const result = await gatewayStub.ensureConnected()

		logger.info('[DiscordScheduled] Gateway bootstrap checked', {
			cron: event.cron,
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			status: result.status,
			reason: result.reason ?? null,
		})
	} catch (error) {
		logger.error('[DiscordScheduled] Gateway bootstrap failed', {
			cron: event.cron,
			scheduledTime: new Date(event.scheduledTime).toISOString(),
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

// Export Hono app wrapped with Sentry for automatic error tracking
export default {
	fetch: sentryApp.fetch.bind(sentryApp),
	scheduled,
}

// Export Durable Object class
// Note: Automatic Sentry instrumentation for DOs is not supported in Cloudflare Workers
// Use manual captureException() in DO methods for error tracking
export { DiscordDO as Discord }
export { DiscordGatewayDO as DiscordGateway }
