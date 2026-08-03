import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import {
	logger,
	withNotFound,
	withOnError,
	withSentry,
	withWorkersLogger,
} from '@repo/hono-helpers'

import { DiscordDO, DiscordGatewayDO } from './durable-object'
import * as discordService from './services/discord.service'
import { resolveDeferralMode, resolveSubcommandKey } from './utils/interaction-routing'

import type {
	Discord,
	DiscordActionRow,
	DiscordEmbed,
	DiscordModalLabelComponent,
} from '@repo/discord'
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
		roles?: string[]
	}
	data?: {
		name?: string
		options?: DiscordInteractionOption[]
		/** Present on MESSAGE_COMPONENT (type 3) + MODAL_SUBMIT (type 5). */
		custom_id?: string
		component_type?: number
		values?: string[]
		/** Modal-submit label tree. Discord returns Label -> component payloads here. */
		components?: Array<Record<string, unknown>>
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
				logger.warn(
					'[DiscordInteractions] Failed to load interaction routing; defaulting to sync',
					{
						error: error instanceof Error ? error.message : String(error),
					}
				)
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
	memberRoleIds?: string[]
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
			memberRoleIds: ctx.memberRoleIds,
			options: ctx.options,
			interactionId: ctx.interactionId,
		})

		// Zero-width space fallback: Discord rejects empty content on an edit.
		const content = execution.response.data?.content ?? '​'
		const stub = getStub<Discord>(env.DISCORD, 'default')
		const result = await stub.editOriginalInteractionResponse(ctx.token, {
			content,
			embeds: execution.response.data?.embeds as DiscordEmbed[] | undefined,
			components: execution.response.data?.components as DiscordActionRow[] | undefined,
		})

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
	selectValues: Record<string, string[]>
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
			selectValues: ctx.selectValues,
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
		const result = await stub.editOriginalInteractionResponse(ctx.token, {
			content,
			components: execution.response.data?.components as DiscordActionRow[] | undefined,
		})
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
	memberRoleIds?: string[]
	values?: string[]
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
			memberRoleIds: ctx.memberRoleIds,
			values: ctx.values ?? [],
		})
		const content = execution.response.data?.content ?? '​'
		const stub = getStub<Discord>(env.DISCORD, 'default')
		const result = await stub.editOriginalInteractionResponse(ctx.token, {
			content,
			components: execution.response.data?.components as DiscordActionRow[] | undefined,
		})
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

type ModalComponentInput = DiscordModalLabelComponent

function buildModalResponse(customId: string, title: string, components: ModalComponentInput[]) {
	return {
		type: DISCORD_RESPONSE_MODAL,
		data: {
			custom_id: customId,
			title,
			components,
		},
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function collectModalSubmissionData(
	node: unknown,
	out: { fields: Record<string, string>; values: Record<string, string[]> }
): void {
	if (!isRecord(node)) return

	const customId = typeof node.custom_id === 'string' ? node.custom_id : null
	const values = Array.isArray(node.values)
		? node.values.filter((value): value is string => typeof value === 'string')
		: null
	const value = typeof node.value === 'string' ? node.value : null
	if (customId) {
		if (values && values.length > 0) {
			out.values[customId] = values
		} else if (value !== null) {
			out.fields[customId] = value
		}
	}

	if (Array.isArray(node.components)) {
		for (const child of node.components) {
			collectModalSubmissionData(child, out)
		}
	}
	if (isRecord(node.component)) {
		collectModalSubmissionData(node.component, out)
	}
}

function hexToBytes(hex: unknown): Uint8Array | null {
	if (typeof hex !== 'string') return null
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
	publicKeyHex: unknown,
	timestamp: string,
	rawBody: string,
	signatureHex: unknown
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
	.use('*', (c, next) =>
		withWorkersLogger(c.env.NAME ?? 'discord', {
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
			logger.info('[DiscordInteractions] Ping interaction', {
				requestId,
				interactionId: interaction.id,
			})
			return c.json({ type: DISCORD_INTERACTION_PING })
		}

		// Component (button) interactions. bet/resolve/void buttons open a modal inline (zero
		// I/O — within the 3s ACK); close/approve defer (they hit the money DO).
		if (interaction.type === DISCORD_INTERACTION_MESSAGE_COMPONENT) {
			const customId = interaction.data?.custom_id ?? ''
			const parts = customId.split(':')
			const componentUserId = interaction.member?.user?.id ?? interaction.user?.id ?? null
			const memberRoleIds = interaction.member?.roles ?? []

			// Temporary role panels reuse the same command executor as /join and /leave. The executor
			// may return a role-selection modal, so this path must remain synchronous for Discord's ACK.
			if (parts[0] === 'tmp-role-panel' && componentUserId) {
				const execution = await c.env.CORE.executeDiscordComponent({
					customId,
					discordUserId: componentUserId,
					interactionId: interaction.id,
					guildId: interaction.guild_id ?? null,
					channelId: interaction.channel_id ?? null,
					memberRoleIds,
					values: interaction.data?.values ?? [],
				})
				return c.json(execution.response)
			}

			if (parts[0] === 'tmp-role' && componentUserId) {
				c.executionCtx.waitUntil(
					runDeferredComponent(c.env, {
						interactionId: interaction.id,
						token: interaction.token,
						customId,
						discordUserId: componentUserId,
						guildId: interaction.guild_id ?? null,
						channelId: interaction.channel_id ?? null,
						memberRoleIds,
						values: interaction.data?.values ?? [],
					})
				)
				return c.json({
					type: DISCORD_INTERACTION_DEFERRED_RESPONSE,
					data: { flags: DISCORD_EPHEMERAL_FLAG },
				})
			}

			// bet:<mkt>:<out> → stake modal
			if (parts[0] === 'bet' && parts.length === 3) {
				return c.json(
					buildModalResponse(`betmodal:${parts[1]}:${parts[2]}`, 'Place a bet', [
						{
							type: 18,
							label: 'Stake (points)',
							component: {
								type: 4,
								custom_id: 'amount',
								style: 1,
								required: true,
								min_length: 1,
								max_length: 12,
								placeholder: '100',
							},
						},
					])
				)
			}

			// mkt:<action>:<mkt> — resolver controls
			if (parts[0] === 'mkt' && parts.length === 3) {
				const [, action, marketId] = parts
				if (action === 'resolve') {
					return c.json(
						buildModalResponse(`resolvemodal:${marketId}`, 'Resolve market', [
							{
								type: 18,
								label: 'Winning outcome number',
								component: {
									type: 4,
									custom_id: 'outcome',
									style: 1,
									required: true,
									min_length: 1,
									max_length: 3,
									placeholder: '1',
								},
							},
						])
					)
				}
				if (action === 'void') {
					return c.json(
						buildModalResponse(`voidmodal:${marketId}`, 'Void market', [
							{
								type: 18,
								label: 'Void reason',
								component: {
									type: 4,
									custom_id: 'reason',
									style: 2,
									required: true,
									min_length: 3,
									max_length: 500,
									placeholder: 'Why is this market being voided?',
								},
							},
						])
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
							memberRoleIds,
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
			const isTemporaryRoleModal = modalAction === 'tmp-role'
			if ((!isMarketModal && !isTemporaryRoleModal) || !modalUserId) {
				return c.json({
					type: 4,
					data: { content: 'This action is not available.', flags: DISCORD_EPHEMERAL_FLAG },
				})
			}
			const submission = {
				fields: {} as Record<string, string>,
				values: {} as Record<string, string[]>,
			}
			for (const component of interaction.data?.components ?? []) {
				collectModalSubmissionData(component, submission)
			}
			if (isTemporaryRoleModal) {
				const values = Object.values(submission.values).flat()
				const execution = await c.env.CORE.executeDiscordModalSubmit({
					interactionId: interaction.id,
					customId,
					discordUserId: modalUserId,
					guildId: interaction.guild_id ?? null,
					channelId: interaction.channel_id ?? null,
					fields: submission.fields,
					selectValues: submission.values,
					values,
				})
				if (!execution.ok) {
					logger.warn('[DiscordInteractions] Temp-role modal returned a non-ok result', {
						requestId,
						interactionId: interaction.id,
						customId,
						discordUserId: modalUserId,
						guildId: interaction.guild_id ?? null,
						coreUserId: execution.coreUserId,
						reason: execution.reason,
					})
				}
				logger.info('[DiscordInteractions] Temp-role modal handled', {
					requestId,
					interactionId: interaction.id,
					customId,
					discordUserId: modalUserId,
					guildId: interaction.guild_id ?? null,
					reason: execution.reason,
					durationMs: Date.now() - startedAt,
				})
				return c.json(execution.response)
			}
			c.executionCtx.waitUntil(
				runDeferredModalSubmit(c.env, {
					interactionId: interaction.id,
					token: interaction.token,
					customId,
					fields: submission.fields,
					selectValues: submission.values,
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
		const memberRoleIds = interaction.member?.roles ?? []

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
					memberRoleIds,
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
				memberRoleIds,
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
			logger.debug?.('[DiscordInteractions] Slash command response payload', {
				requestId,
				interactionId: interaction.id,
				commandName,
				responsePayload: execution.response,
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

async function scheduled(
	event: ScheduledEvent,
	_env: App['Bindings'],
	_ctx: ExecutionContext
): Promise<void> {
	// Intentionally stubbed: the Discord gateway listener has been disabled because
	// the always-on websocket bootstrap caused unacceptable hosting cost inflation.
	// We keep the scheduled entrypoint and gateway DO stub in place so the feature can
	// be reintroduced later without changing the worker shape again.
	logger.info('[DiscordScheduled] Discord gateway bootstrap is disabled; skipping', {
		cron: event.cron,
		scheduledTime: new Date(event.scheduledTime).toISOString(),
	})
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
