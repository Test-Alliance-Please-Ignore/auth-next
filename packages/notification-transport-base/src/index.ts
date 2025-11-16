import { z } from 'zod'

/** Minimal notification config interface to avoid circular dependency */
export interface NotificationConfig {
	coreUserId: string
	notificationType: string
	eventType: string
	enabled: boolean
	notifyCount: number
	lastNotifiedAt: Date | null
}

/** Base transport parameters - all transports extend this */
export type BaseTransportParams = z.infer<typeof BaseTransportParams>
export const BaseTransportParams = z.object({
	destinationId: z.string(),
	notification: z.any(), // Full Notification object with id, type, timestamp, requiresAck, data
})

export interface NotificationTransport<TParams extends z.ZodType = z.ZodType> {
	/** Transport type identifier (e.g., 'websocket', 'discord.message', 'discord.webhook', 'email') */
	readonly type: string

	/** Zod schema defining the transport's required parameters (similar to MCP tool calls) */
	readonly paramsSchema: TParams

	/** Send notification using validated parameters */
	send(
		params: z.infer<TParams>,
		options?: NotificationTransportOptions
	): Promise<NotificationTransportResult>

	/** Optional: check if destination has configured this transport */
	isConfigured?(destinationId: string): Promise<boolean>
}

export interface NotificationTransportOptions {
	userConfig?: NotificationConfig
	metadata?: Record<string, unknown>
}

export interface NotificationTransportResult {
	success: boolean
	error?: Error
	metadata?: Record<string, unknown>
}

/** Registry interface for transports to register themselves */
export interface NotificationTransportRegistry {
	register(transport: NotificationTransport): void
	registerExternal(type: string, config: ExternalTransportConfig): void
	get(type: string): NotificationTransport | ExternalTransportConfig | undefined
	getAll(): Array<NotificationTransport | ExternalTransportConfig>
	has(type: string): boolean
}

export type ExternalTransportConfig =
	| { kind: 'service'; binding: string; paramsSchema: z.ZodType }
	| { kind: 'durable-object'; binding: string; paramsSchema: z.ZodType }
	| { kind: 'queue'; binding: string; paramsSchema: z.ZodType }
	| { kind: 'workflow'; binding: string; paramsSchema: z.ZodType }
	| {
			kind: 'webhook'
			getUrl: (destinationId: string, config: NotificationConfig) => Promise<string | null>
			paramsSchema: z.ZodType
	  }

/** Function signature that all transport packages must export */
export type RegisterTransport = (
	registry: NotificationTransportRegistry,
	env: Record<string, unknown>
) => void

/** Base class for internal transports */
export abstract class BaseNotificationTransport<TParams extends z.ZodType = z.ZodType>
	implements NotificationTransport<TParams>
{
	abstract readonly type: string
	abstract readonly paramsSchema: TParams

	abstract send(
		params: z.infer<TParams>,
		options?: NotificationTransportOptions
	): Promise<NotificationTransportResult>

	isConfigured?(destinationId: string): Promise<boolean> {
		return Promise.resolve(true)
	}
}
