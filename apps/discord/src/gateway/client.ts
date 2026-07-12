import { DiscordBotService } from '../services/discord-bot.service'
import { defaultDiscordGatewayHandlers } from './handlers'
import { createDiscordGatewayEventRegistry } from './registry'
import { DiscordGatewayEventRouter } from './router'
import { DISCORD_GATEWAY_VERSION } from './types'

import { logger } from '@repo/hono-helpers'

import type { Env } from '../context'
import type {
	DiscordGateway,
	DiscordGatewayBootstrapResult,
	DiscordGatewayEnvelope,
	DiscordGatewayHelloPayload,
	DiscordGatewayJoinSuppressionLookupResult,
	DiscordGatewayReadyPayload,
	DiscordGatewayStatus,
} from './types'

function buildDiscordGatewayWebSocketUrl(rawUrl: string): string {
	const url = new URL(rawUrl)
	if (url.protocol === 'http:') {
		url.protocol = 'ws:'
	} else if (url.protocol === 'https:') {
		url.protocol = 'wss:'
	}
	url.searchParams.set('v', String(DISCORD_GATEWAY_VERSION))
	url.searchParams.set('encoding', 'json')
	return url.toString()
}

export class DiscordGatewayClient implements DiscordGateway {
	private readonly router = new DiscordGatewayEventRouter(
		createDiscordGatewayEventRegistry(defaultDiscordGatewayHandlers)
	)
	private readonly gatewayEnabled: boolean
	private websocket: WebSocket | null = null
	private connectPromise: Promise<DiscordGatewayBootstrapResult> | null = null
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null
	private suppressNextCloseReconnect = false
	private reconnectAttempt = 0
	private gatewayUrl: string | null = null
	private resumeGatewayUrl: string | null = null
	private sessionId: string | null = null
	private sequence: number | null = null
	private heartbeatIntervalMs: number | null = null
	private lastHelloAt: string | null = null
	private lastHeartbeatAckAt: string | null = null
	private lastEventAt: string | null = null
	private lastError: string | null = null
	private connectionState: DiscordGatewayStatus['connectionState'] = 'idle'

	constructor(
		private readonly state: DurableObjectState,
		private readonly env: Env
	) {
		this.gatewayEnabled = env.DISCORD_GATEWAY_ENABLED === 'true'

		state.blockConcurrencyWhile(async () => {
			const persisted = await state.storage.get<Partial<DiscordGatewayStatus>>('gateway-state')
			if (!persisted) {
				return
			}

			this.gatewayUrl = persisted.gatewayUrl ?? null
			this.resumeGatewayUrl = persisted.resumeGatewayUrl ?? null
			this.sessionId = persisted.sessionId ?? null
			this.sequence = persisted.sequence ?? null
			this.heartbeatIntervalMs = persisted.heartbeatIntervalMs ?? null
			this.lastHelloAt = persisted.lastHelloAt ?? null
			this.lastHeartbeatAckAt = persisted.lastHeartbeatAckAt ?? null
			this.lastEventAt = persisted.lastEventAt ?? null
			this.lastError = persisted.lastError ?? null
			this.connectionState = persisted.connectionState ?? 'idle'

			if (!this.gatewayEnabled) {
				this.connectionState = 'disabled'
				this.lastError = 'Discord gateway is disabled by configuration'
			}
		})
	}

	private getStatus(): DiscordGatewayStatus {
		return {
			connected: this.websocket?.readyState === WebSocket.OPEN,
			connectionState: this.connectionState,
			gatewayUrl: this.gatewayUrl,
			resumeGatewayUrl: this.resumeGatewayUrl,
			sessionId: this.sessionId,
			sequence: this.sequence,
			heartbeatIntervalMs: this.heartbeatIntervalMs,
			lastHelloAt: this.lastHelloAt,
			lastHeartbeatAckAt: this.lastHeartbeatAckAt,
			lastEventAt: this.lastEventAt,
			lastError: this.lastError,
		}
	}

	private async persistStatus(): Promise<void> {
		await this.state.storage.put('gateway-state', this.getStatus())
	}

	private getJoinSuppressionKey(discordUserId: string, guildId: string): string {
		return `join-suppression:${discordUserId}:${guildId}`
	}

	private async reserveSingleJoinSuppression(
		discordUserId: string,
		guildId: string,
		expiresInMs: number,
		reason: string
	): Promise<boolean> {
		const now = Date.now()
		const record = {
			discordUserId,
			guildId,
			expiresAt: now + expiresInMs,
			reason,
			createdAt: now,
		}

		await this.state.storage.put(this.getJoinSuppressionKey(discordUserId, guildId), record)
		return true
	}

	private async getJoinSuppressionRecord(discordUserId: string, guildId: string): Promise<{
		record: {
			discordUserId: string
			guildId: string
			expiresAt: number
			reason: string
			createdAt: number
		} | null
		expired: boolean
	}> {
		const key = this.getJoinSuppressionKey(discordUserId, guildId)
		const record = await this.state.storage.get<{
			discordUserId: string
			guildId: string
			expiresAt: number
			reason: string
			createdAt: number
		}>(key)

		if (!record) {
			return {
				record: null,
				expired: false,
			}
		}

		if (record.expiresAt <= Date.now()) {
			await this.state.storage.delete(key)
			return {
				record: null,
				expired: true,
			}
		}

		return {
			record,
			expired: false,
		}
	}

	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = null
		}
	}

	private clearReconnectTimer(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	private closeWebSocket(code = 1000, reason = 'reconnect', suppressReconnect = false): void {
		try {
			this.suppressNextCloseReconnect = suppressReconnect
			this.websocket?.close(code, reason)
		} catch {
			// Ignore close failures; reconnect logic will recover.
		} finally {
			this.websocket = null
		}
	}

	private async resolveGatewayUrl(): Promise<string> {
		if (this.resumeGatewayUrl) {
			return this.resumeGatewayUrl
		}

		if (this.gatewayUrl) {
			return this.gatewayUrl
		}

		const botService = new DiscordBotService(this.env)
		const gatewayInfo = await botService.getGatewayBotInfo()
		this.gatewayUrl = buildDiscordGatewayWebSocketUrl(gatewayInfo.url)
		await this.persistStatus()

		if (gatewayInfo.shards > 1) {
			logger.warn('[DiscordGateway] Discord recommended multiple shards, using a single listener for now', {
				recommendedShards: gatewayInfo.shards,
			})
		}

		return this.gatewayUrl
	}

	private async sendJson(payload: unknown): Promise<void> {
		if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
			throw new Error('Gateway socket is not open')
		}

		this.websocket.send(JSON.stringify(payload))
	}

	private async sendHeartbeat(): Promise<void> {
		await this.sendJson({
			op: 1,
			d: this.sequence,
		})

		this.lastEventAt = new Date().toISOString()
		await this.persistStatus()
	}

	private async sendIdentify(resume: boolean): Promise<void> {
		if (resume && this.sessionId && this.sequence !== null && this.resumeGatewayUrl) {
			this.connectionState = 'resuming'
			await this.persistStatus()
			await this.sendJson({
				op: 6,
				d: {
					token: this.env.DISCORD_BOT_TOKEN,
					session_id: this.sessionId,
					seq: this.sequence,
				},
			})
			return
		}

		this.connectionState = 'connecting'
		await this.persistStatus()
		await this.sendJson({
			op: 2,
			d: {
				token: this.env.DISCORD_BOT_TOKEN,
				intents: 1 << 1,
				properties: {
					os: 'cloudflare-worker',
					browser: 'auth-next-discord-worker',
					device: 'auth-next-discord-worker',
				},
				compress: false,
				large_threshold: 50,
			},
		})
	}

	private async handleGatewayDispatch(
		envelope: DiscordGatewayEnvelope,
		payload: unknown
	): Promise<void> {
		this.sequence = envelope.s
		this.lastEventAt = new Date().toISOString()
		await this.persistStatus()

		if (envelope.t === 'READY') {
			await this.handleReady(payload as DiscordGatewayReadyPayload)
			return
		}

		if (envelope.t === 'RESUMED') {
			this.connectionState = 'open'
			this.lastError = null
			await this.persistStatus()
			return
		}

		try {
			await this.router.route(
				{
					...envelope,
					d: payload,
				},
				{
					env: this.env,
					eventName: envelope.t ?? 'UNKNOWN',
					payload,
					sequence: envelope.s,
				}
			)
		} catch (error) {
			logger.error('[DiscordGateway] Failed to handle gateway dispatch', {
				eventName: envelope.t,
				sequence: envelope.s,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private async handleHello(payload: DiscordGatewayHelloPayload): Promise<void> {
		this.heartbeatIntervalMs = payload.heartbeat_interval
		this.lastHelloAt = new Date().toISOString()
		this.connectionState = this.sessionId && this.sequence !== null ? 'resuming' : 'connecting'
		this.clearHeartbeatTimer()
		await this.persistStatus()

		await this.sendIdentify(Boolean(this.sessionId && this.sequence !== null))

		this.heartbeatTimer = setInterval(() => {
			void this.sendHeartbeat().catch((error) => {
				logger.error('[DiscordGateway] Failed to send heartbeat', {
					error: error instanceof Error ? error.message : String(error),
				})
			})
		}, payload.heartbeat_interval)

		this.state.storage.setAlarm(Date.now() + payload.heartbeat_interval * 2)
	}

	private async handleReady(payload: DiscordGatewayReadyPayload): Promise<void> {
		this.sessionId = payload.session_id
		this.resumeGatewayUrl = payload.resume_gateway_url
			? buildDiscordGatewayWebSocketUrl(payload.resume_gateway_url)
			: this.gatewayUrl
		this.reconnectAttempt = 0
		this.connectionState = 'open'
		this.lastError = null
		await this.persistStatus()
	}

	private async handleHeartbeatAck(): Promise<void> {
		this.lastHeartbeatAckAt = new Date().toISOString()
		await this.persistStatus()
		if (this.heartbeatIntervalMs) {
			this.state.storage.setAlarm(Date.now() + this.heartbeatIntervalMs * 2)
		}
	}

	private async handleInvalidSession(canResume: boolean): Promise<void> {
		logger.warn('[DiscordGateway] Received invalid session signal', {
			canResume,
			hasSessionId: Boolean(this.sessionId),
			hasSequence: this.sequence !== null,
		})

		if (!canResume) {
			this.sessionId = null
			this.sequence = null
			this.resumeGatewayUrl = null
		}

		this.closeWebSocket(4000, 'invalid-session', true)
		this.connectionState = 'idle'
		await this.persistStatus()
		this.scheduleReconnect(canResume ? 'resume-retry' : 'identify-retry')
	}

	private scheduleReconnect(reason: string): void {
		if (!this.gatewayEnabled) {
			return
		}

		this.clearReconnectTimer()
		this.clearHeartbeatTimer()

		const delayMs = Math.min(5 * 60 * 1000, 1000 * Math.pow(2, this.reconnectAttempt))
		this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 8)

		logger.info('[DiscordGateway] Scheduling reconnect', {
			reason,
			delayMs,
			reconnectAttempt: this.reconnectAttempt,
		})

		this.reconnectTimer = setTimeout(() => {
			void this.connect(true).catch((error) => {
				logger.error('[DiscordGateway] Reconnect failed', {
					reason,
					error: error instanceof Error ? error.message : String(error),
				})
				this.scheduleReconnect('reconnect-error')
			})
		}, delayMs)

		this.state.storage.setAlarm(Date.now() + delayMs)
	}

	private async connect(resume = true): Promise<DiscordGatewayBootstrapResult> {
		if (!this.gatewayEnabled) {
			this.closeWebSocket(1000, 'gateway-disabled', true)
			this.clearReconnectTimer()
			this.clearHeartbeatTimer()
			this.connectionState = 'disabled'
			this.lastError = 'Discord gateway is disabled by configuration'
			await this.persistStatus()
			return { status: 'disabled' as const, reason: 'Discord gateway is disabled' }
		}

		if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
			return { status: 'already-running' }
		}

		if (this.connectPromise) {
			return { status: 'connecting' }
		}

		this.connectPromise = (async () => {
			try {
				this.clearReconnectTimer()
				this.closeWebSocket(1000, 'connect', true)

				const gatewayUrl = await this.resolveGatewayUrl()
				const ws = new WebSocket(gatewayUrl)
				this.websocket = ws
				this.connectionState = 'connecting'
				this.lastError = null
				await this.persistStatus()

				ws.addEventListener('open', () => {
					logger.info('[DiscordGateway] WebSocket opened', {
						gatewayUrl,
						resume: Boolean(resume && this.sessionId && this.sequence !== null),
					})
				})

				ws.addEventListener('message', (event: MessageEvent) => {
					void (async () => {
						try {
							const raw =
								typeof event.data === 'string'
									? event.data
									: event.data instanceof ArrayBuffer
										? new TextDecoder().decode(event.data)
										: event.data instanceof Blob
											? await event.data.text()
											: String(event.data)
							const envelope = JSON.parse(raw) as DiscordGatewayEnvelope

							switch (envelope.op) {
								case 10:
									await this.handleHello(envelope.d as DiscordGatewayHelloPayload)
									return
								case 11:
									await this.handleHeartbeatAck()
									return
								case 0:
									await this.handleGatewayDispatch(envelope, envelope.d)
									return
								case 7:
									logger.warn('[DiscordGateway] Discord requested reconnect')
									this.closeWebSocket(1012, 'discord-reconnect')
									this.connectionState = 'idle'
									await this.persistStatus()
									this.scheduleReconnect('discord-reconnect')
									return
								case 9:
									await this.handleInvalidSession(Boolean(envelope.d))
									return
								default:
									logger.debug('[DiscordGateway] Ignoring gateway opcode', {
										op: envelope.op,
									})
							}
						} catch (error) {
							logger.error('[DiscordGateway] Failed to process gateway message', {
								error: error instanceof Error ? error.message : String(error),
							})
						}
					})()
				})

				ws.addEventListener('error', (event: Event) => {
					const errorMessage =
						event instanceof ErrorEvent ? event.message : 'Discord gateway socket error'
					this.lastError = errorMessage
					void this.persistStatus()
					logger.error('[DiscordGateway] WebSocket error', {
						error: errorMessage,
					})
				})

				ws.addEventListener('close', (event: CloseEvent) => {
					if (this.suppressNextCloseReconnect) {
						this.suppressNextCloseReconnect = false
						this.websocket = null
						this.connectionState = 'idle'
						this.clearHeartbeatTimer()
						void this.persistStatus()
						return
					}

					logger.warn('[DiscordGateway] WebSocket closed', {
						code: event.code,
						reason: event.reason,
						wasClean: event.wasClean,
					})
					this.websocket = null
					this.connectionState = 'disconnected'
					this.clearHeartbeatTimer()
					void this.persistStatus()
					this.scheduleReconnect(`close-${event.code}`)
				})

				return { status: 'started' as const }
			} catch (error) {
				this.lastError = error instanceof Error ? error.message : String(error)
				await this.persistStatus()
				logger.error('[DiscordGateway] Failed to connect gateway socket', {
					error: this.lastError,
				})
				this.scheduleReconnect('connect-error')
				throw error
			} finally {
				this.connectPromise = null
			}
		})()

		return this.connectPromise
	}

	async ensureConnected(): Promise<DiscordGatewayBootstrapResult> {
		try {
			return await this.connect(true)
		} catch (error) {
			return {
				status: 'failed',
				reason: error instanceof Error ? error.message : String(error),
			}
		}
	}

	async getGatewayStatus(): Promise<DiscordGatewayStatus> {
		return this.getStatus()
	}

	async alarm(): Promise<void> {
		if (!this.gatewayEnabled) {
			await this.shutdown()
			return
		}

		const status = this.getStatus()
		logger.info('[DiscordGateway] Alarm triggered', {
			connectionState: status.connectionState,
			connected: status.connected,
		})
		await this.connect(true)
	}

	async shutdown(): Promise<void> {
		this.clearReconnectTimer()
		this.clearHeartbeatTimer()
		this.closeWebSocket(1000, 'gateway-disabled', true)
		this.gatewayUrl = null
		this.resumeGatewayUrl = null
		this.sessionId = null
		this.sequence = null
		this.heartbeatIntervalMs = null
		this.lastHelloAt = null
		this.lastHeartbeatAckAt = null
		this.lastEventAt = null
		this.lastError = 'Discord gateway is disabled by configuration'
		this.connectionState = 'disabled'
		await this.persistStatus()
	}

	async reserveJoinSuppressions(input: {
		discordUserId: string
		guildIds: string[]
		expiresInMs?: number
		reason?: string
	}): Promise<{ reservedGuildIds: string[] }> {
		const guildIds = [...new Set(input.guildIds.map((guildId) => guildId.trim()).filter(Boolean))]
		if (guildIds.length === 0) {
			return { reservedGuildIds: [] }
		}

		const expiresInMs = Math.max(30_000, input.expiresInMs ?? 120_000)
		const reason = input.reason ?? 'auto-invite'

		const reservedGuildIds: string[] = []
		for (const guildId of guildIds) {
			await this.reserveSingleJoinSuppression(input.discordUserId, guildId, expiresInMs, reason)
			reservedGuildIds.push(guildId)
		}

		logger.debug('[DiscordGateway] Reserved join suppressions', {
			discordUserId: input.discordUserId,
			reservedGuildIds,
			expiresInMs,
			reason,
		})

		return { reservedGuildIds }
	}

	async releaseJoinSuppressions(input: {
		discordUserId: string
		guildIds: string[]
	}): Promise<{ releasedGuildIds: string[] }> {
		const guildIds = [...new Set(input.guildIds.map((guildId) => guildId.trim()).filter(Boolean))]
		if (guildIds.length === 0) {
			return { releasedGuildIds: [] }
		}

		const releasedGuildIds: string[] = []
		for (const guildId of guildIds) {
			const key = this.getJoinSuppressionKey(input.discordUserId, guildId)
			const existing = await this.state.storage.get<{
				expiresAt: number
			}>(key)
			if (!existing) {
				continue
			}

			await this.state.storage.delete(key)
			releasedGuildIds.push(guildId)
		}

		if (releasedGuildIds.length > 0) {
			logger.debug('[DiscordGateway] Released join suppressions', {
				discordUserId: input.discordUserId,
				releasedGuildIds,
			})
		}

		return { releasedGuildIds }
	}

	async consumeJoinSuppression(input: {
		discordUserId: string
		guildId: string
	}): Promise<DiscordGatewayJoinSuppressionLookupResult> {
		const lookup = await this.getJoinSuppressionRecord(input.discordUserId, input.guildId)
		if (!lookup.record) {
			return {
				suppressed: false,
				alreadyExpired: lookup.expired,
			}
		}

		await this.state.storage.delete(this.getJoinSuppressionKey(input.discordUserId, input.guildId))
		return {
			suppressed: true,
			alreadyExpired: false,
		}
	}
}
