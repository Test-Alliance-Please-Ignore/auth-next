import type { Env } from '../context'

export const DISCORD_GATEWAY_VERSION = 10
export const DISCORD_GATEWAY_INTENTS = 1 << 1

export const DISCORD_GATEWAY_OP = {
	DISPATCH: 0,
	HEARTBEAT: 1,
	IDENTIFY: 2,
	RESUME: 6,
	RECONNECT: 7,
	INVALID_SESSION: 9,
	HELLO: 10,
	HEARTBEAT_ACK: 11,
} as const

export type DiscordGatewayDispatchEventName = 'GUILD_MEMBER_ADD' | string

export interface DiscordGatewayEnvelope<T = unknown> {
	op: number
	d: T
	s: number | null
	t: DiscordGatewayDispatchEventName | null
}

export interface DiscordGatewayHelloPayload {
	heartbeat_interval: number
}

export interface DiscordGatewayReadyPayload {
	session_id: string
	resume_gateway_url?: string
}

export interface DiscordGatewayGuildMemberAddPayload {
	guild_id: string
	user?: {
		id?: string
		bot?: boolean
	}
	member?: {
		user?: {
			id?: string
			bot?: boolean
		}
		nick?: string | null
	}
}

export interface DiscordGatewayContext<T = unknown> {
	env: Env
	eventName: DiscordGatewayDispatchEventName
	payload: T
	sequence: number | null
}

export interface DiscordGatewayEventHandler<T = unknown> {
	eventName: DiscordGatewayDispatchEventName
	handle(context: DiscordGatewayContext<T>): Promise<void>
}

export interface DiscordGatewayStatus {
	connected: boolean
	connectionState: 'idle' | 'connecting' | 'open' | 'resuming' | 'disconnected'
	gatewayUrl: string | null
	resumeGatewayUrl: string | null
	sessionId: string | null
	sequence: number | null
	heartbeatIntervalMs: number | null
	lastHelloAt: string | null
	lastHeartbeatAckAt: string | null
	lastEventAt: string | null
	lastError: string | null
}

export interface DiscordGatewayBootstrapResult {
	status: 'started' | 'already-running' | 'connecting' | 'failed'
	reason?: string
}

export interface DiscordGatewayJoinSuppressionReservation {
	discordUserId: string
	guildId: string
	expiresAt: number
	reason: string
}

export interface DiscordGatewayJoinSuppressionLookupResult {
	suppressed: boolean
	alreadyExpired: boolean
}

export interface DiscordGateway {
	ensureConnected(): Promise<DiscordGatewayBootstrapResult>
	getGatewayStatus(): Promise<DiscordGatewayStatus>
	alarm(): Promise<void>
	reserveJoinSuppressions(input: {
		discordUserId: string
		guildIds: string[]
		expiresInMs?: number
		reason?: string
	}): Promise<{ reservedGuildIds: string[] }>
	releaseJoinSuppressions(input: {
		discordUserId: string
		guildIds: string[]
	}): Promise<{ releasedGuildIds: string[] }>
	consumeJoinSuppression(input: {
		discordUserId: string
		guildId: string
	}): Promise<DiscordGatewayJoinSuppressionLookupResult>
}
