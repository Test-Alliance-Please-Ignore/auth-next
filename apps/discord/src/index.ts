import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { getStub } from '@repo/do-utils'
import { useWorkersLogger } from 'workers-tagged-logger'
import { z } from 'zod'

import { logger, withNotFound, withOnError, withSentry } from '@repo/hono-helpers'

import { DiscordDO, DiscordGatewayDO } from './durable-object'
import type { DiscordGateway } from './gateway/types'
import * as discordService from './services/discord.service'
import { resolveDeferralMode, resolveSubcommandKey } from './utils/interaction-routing'

import type { Discord } from '@repo/discord'
import type { App, DiscordInteractionOption, DiscordInteractionRouting } from './context'

const DISCORD_INTERACTION_PING = 1
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2
const DISCORD_INTERACTION_MESSAGE_COMPONENT = 3
const DISCORD_INTERACTION_MODAL_SUBMIT = 5
const DISCORD_INTERACTION_DEFERRED_RESPONSE = 5 // response type: DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
const DISCORD_RESPONSE_MODAL = 9 // response type: MODAL
const DISCORD_EPHEMERAL_FLAG = 1 << 6
const DISCORD_REPLAY_WINDOW_SECONDS = 5 * 60
const DISCORD_ROUTING_CACHE_TTL_MS = 60_000

interface DiscordInteractionPayload {
	id: string
	type: number
	token: string
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
		/** Present on MESSAGE_COMPONENT (type 3) + MODAL_SUBMIT (type 5). */
		custom_id?: string
		component_type?: number
		values?: string[]
		/** Modal-submit action rows → text inputs. */
		components?: Array<{
			type: number
			components?: Array<{ type: number; custom_id?: string; value?: string }>
		}>
	}
	/** Source message on a component interaction (unreliable on modal submit). */
	message?: { id: string }
}

interface RoutingCacheState {
	value: DiscordInteractionRouting | null
	loadedAtMs: number
	loading: Promise<DiscordInteractionRouting> | null
}

const routingCache: RoutingCacheState = {
	value: null,
	loadedAtMs: 0,
	loading: null,
}

/**
 * Load the interaction deferral routing map from core, cached for 60s (mirrors core's own
 * registry TTL). On failure, fall back to the last known value or an empty map (⇒ all 'sync',
 * preserving today's synchronous behavior).
 */
async function getInteractionRouting(env: App['Bindings']): Promise<DiscordInteractionRouting> {
	if (routingCache.value && Date.now() - routingCache.loadedAtMs < DISCORD_ROUTING_CACHE_TTL_MS) {
		return routingCache.value
	}

	if (!routingCache.loading) {
		routingCache.loading = (async () => {
			try {
				const routing = await env.CORE.getDiscordInteractionRouting()
				routingCache.value = routing
				routingCache.loadedAtMs = Date.now()
				return routing
			} catch (error) {
				logger.warn('[DiscordInteractions] Failed to load interaction routing; defaulting to sync', {
					error: error instanceof Error ? error.message : String(error),
				})
				return routingCache.value ?? { commands: {} }
			} finally {
				routingCache.loading = null
			}
		})()
	}

	return routingCache.loading
}

interface DeferredCommandContext {
	interactionId: string
	token: string
	commandName: string
	discordUserId: string
	guildId: string | null
	channelId: string | null
	options: DiscordInteractionOption[]
}

/**
 * Run a deferred slash command out-of-band (after the type:5 ACK) and deliver the result by
 * editing the original interaction response. Any failure is delivered as an error message so
 * the user never sees a stuck "thinking…" state.
 */
async function runDeferredCommand(
	env: App['Bindings'],
	ctx: DeferredCommandContext
): Promise<void> {
	const startedAt = Date.now()
	try {
		const execution = await env.CORE.executeDiscordSlashCommand({
			commandName: ctx.commandName,
			discordUserId: ctx.discordUserId,
			guildId: ctx.guildId,
			channelId: ctx.channelId,
			options: ctx.options,
			interactionId: ctx.interactionId,
		})

		// Zero-width space fallback: Discord rejects empty content on an edit.
		const content = execution.response.data?.content ?? '​'
		const stub = getStub<Discord>(env.DISCORD, 'default')
		const result = await stub.editOriginalInteractionResponse(ctx.token, { content })

		if (!result.success) {
			logger.error('[DiscordInteractions] Failed to deliver deferred response', {
				interactionId: ctx.interactionId,
				commandName: ctx.commandName,
				error: result.error,
				durationMs: Date.now() - startedAt,
			})
		}
	} catch (error) {
		logger.error('[DiscordInteractions] Deferred command execution failed', {
			interactionId: ctx.interactionId,
			commandName: ctx.commandName,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startedAt,
		})
		try {
			const stub = getStub<Discord>(env.DISCORD, 'default')
			await stub.editOriginalInteractionResponse(ctx.token, {
				content: 'Command execution failed. Please try again later.',
			})
		} catch {
			// Best-effort delivery; nothing more we can do.
		}
	}
}

interface DeferredModalSubmitContext {
	interactionId: string
	token: string
	customId: string
	fields: Record<string, string>
	discordUserId: string
	guildId: string | null
	channelId: string | null
}

/**
 * Run a deferred modal submit (a bet) after the type:5 ephemeral ACK: call core (which runs
 * placeBet + refreshes the public post) and deliver the ephemeral confirmation by editing the
 * original interaction response. Failures deliver an error so the user never sees "thinking…".
 */
async function runDeferredModalSubmit(
	env: App['Bindings'],
	ctx: DeferredModalSubmitContext
): Promise<void> {
	const startedAt = Date.now()
	try {
		const execution = await env.CORE.executeDiscordModalSubmit({
			customId: ctx.customId,
			fields: ctx.fields,
			discordUserId: ctx.discordUserId,
			interactionId: ctx.interactionId,
			guildId: ctx.guildId,
			channelId: ctx.channelId,
		})
		// Core returns ok:false when it hands back a graceful error ephemeral (domain rejection OR
		// an infra failure it already logged/paged). We still deliver that content to the user, but
		// log it here too — otherwise a failed bet is invisible on this side of the RPC boundary.
		if (!execution.ok) {
			logger.warn('[DiscordInteractions] Modal submit returned an error result', {
				interactionId: ctx.interactionId,
				customId: ctx.customId,
				reason: execution.reason,
				coreUserId: execution.coreUserId,
			})
		}
		const content = execution.response.data?.content ?? '​'
		const stub = getStub<Discord>(env.DISCORD, 'default')
		const result = await stub.editOriginalInteractionResponse(ctx.token, { content })
		if (!result.success) {
			logger.error('[DiscordInteractions] Failed to deliver modal-submit response', {
				interactionId: ctx.interactionId,
				error: result.error,
				durationMs: Date.now() - startedAt,
			})
		}
	} catch (error) {
		logger.error('[DiscordInteractions] Deferred modal submit failed', {
			interactionId: ctx.interactionId,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startedAt,
		})
		try {
			const stub = getStub<Discord>(env.DISCORD, 'default')
			await stub.editOriginalInteractionResponse(ctx.token, {
				content: 'Could not process your bet. Please try again later.',
			})
		} catch {
			// Best-effort delivery; nothing more we can do.
		}
	}
}

interface DeferredComponentContext {
	interactionId: string
	token: string
	customId: string
	discordUserId: string
	guildId: string | null
	channelId: string | null
}

/**
 * Run a deferred component (button) interaction after the type:5 ephemeral ACK — P3 resolver
 * Close/Approve. Calls core (which runs the PM write + refreshes the public post) and delivers
 * the ephemeral confirmation by editing the original interaction response.
 */
async function runDeferredComponent(
	env: App['Bindings'],
	ctx: DeferredComponentContext
): Promise<void> {
	const startedAt = Date.now()
	try {
		const execution = await env.CORE.executeDiscordComponent({
			customId: ctx.customId,
			discordUserId: ctx.discordUserId,
			interactionId: ctx.interactionId,
			guildId: ctx.guildId,
			channelId: ctx.channelId,
		})
		const content = execution.response.data?.content ?? '​'
		const stub = getStub<Discord>(env.DISCORD, 'default')
		const result = await stub.editOriginalInteractionResponse(ctx.token, { content })
		if (!result.success) {
			logger.error('[DiscordInteractions] Failed to deliver component response', {
				interactionId: ctx.interactionId,
				error: result.error,
				durationMs: Date.now() - startedAt,
			})
		}
	} catch (error) {
		logger.error('[DiscordInteractions] Deferred component failed', {
			interactionId: ctx.interactionId,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startedAt,
		})
		try {
			const stub = getStub<Discord>(env.DISCORD, 'default')
			await stub.editOriginalInteractionResponse(ctx.token, {
				content: 'Could not complete this action. Please try again later.',
			})
		} catch {
			// Best-effort delivery; nothing more we can do.
		}
	}
}

/** Build a type:9 MODAL response with a single required text input. */
function buildModalResponse(
	customId: string,
	title: string,
	input: {
		customId: string
		label: string
		style: 1 | 2 // 1 SHORT, 2 PARAGRAPH
		minLength?: number
		maxLength?: number
		placeholder?: string
	}
) {
	return {
		type: DISCORD_RESPONSE_MODAL,
		data: {
			custom_id: customId,
			title,
			components: [
				{
					type: 1, // ACTION_ROW
					components: [
						{
							type: 4, // TEXT_INPUT
							custom_id: input.customId,
							style: input.style,
							label: input.label,
							required: true,
							...(input.minLength !== undefined ? { min_length: input.minLength } : {}),
							...(input.maxLength !== undefined ? { max_length: input.maxLength } : {}),
							...(input.placeholder ? { placeholder: input.placeholder } : {}),
						},
					],
				},
			],
		},
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

		// Component (button) interactions. bet/resolve/void buttons open a modal inline (zero
		// I/O — within the 3s ACK); close/approve defer (they hit the money DO).
		if (interaction.type === DISCORD_INTERACTION_MESSAGE_COMPONENT) {
			const customId = interaction.data?.custom_id ?? ''
			const parts = customId.split(':')
			const componentUserId = interaction.member?.user?.id ?? interaction.user?.id ?? null

			// bet:<mkt>:<out> → stake modal
			if (parts[0] === 'bet' && parts.length === 3) {
				return c.json(
					buildModalResponse(`betmodal:${parts[1]}:${parts[2]}`, 'Place a bet', {
						customId: 'amount',
						label: 'Stake (points)',
						style: 1,
						minLength: 1,
						maxLength: 12,
						placeholder: '100',
					})
				)
			}

			// mkt:<action>:<mkt> — resolver controls
			if (parts[0] === 'mkt' && parts.length === 3) {
				const [, action, marketId] = parts
				if (action === 'resolve') {
					return c.json(
						buildModalResponse(`resolvemodal:${marketId}`, 'Resolve market', {
							customId: 'outcome',
							label: 'Winning outcome number',
							style: 1,
							minLength: 1,
							maxLength: 3,
							placeholder: '1',
						})
					)
				}
				if (action === 'void') {
					return c.json(
						buildModalResponse(`voidmodal:${marketId}`, 'Void market', {
							customId: 'reason',
							label: 'Void reason',
							style: 2,
							minLength: 3,
							maxLength: 500,
							placeholder: 'Why is this market being voided?',
						})
					)
				}
				if ((action === 'close' || action === 'approve') && componentUserId) {
					c.executionCtx.waitUntil(
						runDeferredComponent(c.env, {
							interactionId: interaction.id,
							token: interaction.token,
							customId,
							discordUserId: componentUserId,
							guildId: interaction.guild_id ?? null,
							channelId: interaction.channel_id ?? null,
						})
					)
					return c.json({
						type: DISCORD_INTERACTION_DEFERRED_RESPONSE,
						data: { flags: DISCORD_EPHEMERAL_FLAG },
					})
				}
			}

			logger.warn('[DiscordInteractions] Unsupported component', {
				requestId,
				interactionId: interaction.id,
				customId,
			})
			return c.json({
				type: 4,
				data: { content: 'This action is not available.', flags: DISCORD_EPHEMERAL_FLAG },
			})
		}

		// Modal submits. A "betmodal" submit places the bet: defer (ephemeral) then run
		// placeBet out-of-band, since it hits Neon + the money DO and may exceed 3s.
		if (interaction.type === DISCORD_INTERACTION_MODAL_SUBMIT) {
			const customId = interaction.data?.custom_id ?? ''
			const modalUserId = interaction.member?.user?.id ?? interaction.user?.id ?? null
			const modalAction = customId.split(':')[0]
			const isMarketModal =
				modalAction === 'betmodal' || modalAction === 'resolvemodal' || modalAction === 'voidmodal'
			if (!isMarketModal || !modalUserId) {
				return c.json({
					type: 4,
					data: { content: 'This action is not available.', flags: DISCORD_EPHEMERAL_FLAG },
				})
			}
			const fields: Record<string, string> = {}
			for (const row of interaction.data?.components ?? []) {
				for (const comp of row.components ?? []) {
					if (comp.custom_id) fields[comp.custom_id] = comp.value ?? ''
				}
			}
			c.executionCtx.waitUntil(
				runDeferredModalSubmit(c.env, {
					interactionId: interaction.id,
					token: interaction.token,
					customId,
					fields,
					discordUserId: modalUserId,
					guildId: interaction.guild_id ?? null,
					channelId: interaction.channel_id ?? null,
				})
			)
			return c.json({
				type: DISCORD_INTERACTION_DEFERRED_RESPONSE,
				data: { flags: DISCORD_EPHEMERAL_FLAG },
			})
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

		const routing = await getInteractionRouting(c.env)
		const subKey = resolveSubcommandKey(interaction.data.options)
		const deferralMode = resolveDeferralMode(routing, commandName.trim().toLowerCase(), subKey)

		if (deferralMode !== 'sync') {
			// Deferred path: ACK within 3s (type:5), then run the work out-of-band and deliver
			// via a followup edit. Ephemerality is fixed here at ACK time.
			logger.info('[DiscordInteractions] Deferring slash command', {
				requestId,
				interactionId: interaction.id,
				commandName,
				deferralMode,
			})
			c.executionCtx.waitUntil(
				runDeferredCommand(c.env, {
					interactionId: interaction.id,
					token: interaction.token,
					commandName,
					discordUserId,
					guildId,
					channelId,
					options: interaction.data.options ?? [],
				})
			)
			return c.json({
				type: DISCORD_INTERACTION_DEFERRED_RESPONSE,
				data: deferralMode === 'defer-ephemeral' ? { flags: DISCORD_EPHEMERAL_FLAG } : {},
			})
		}

		try {
			const execution = await c.env.CORE.executeDiscordSlashCommand({
				commandName,
				discordUserId,
				guildId,
				channelId,
				options: interaction.data.options ?? [],
				interactionId: interaction.id,
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
