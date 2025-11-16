import type {
	ExternalTransportConfig,
	NotificationConfig,
	NotificationTransport,
	NotificationTransportOptions,
	NotificationTransportRegistry,
	NotificationTransportResult,
} from '@repo/notification-transport-base'

import { executeQueueTransport } from './transports/queue'
import { executeServiceBindingTransport } from './transports/service-binding'
import { executeDurableObjectTransport } from './transports/durable-object'
import { executeWorkflowTransport } from './transports/workflow'
import { executeWebhookTransport } from './transports/webhook'

// Import Notification type from the same package (type-only import to avoid circular dependency issues)
import type { Notification } from './index'

/** Interface for NotificationConfigService to avoid circular dependency */
export interface NotificationConfigService {
	getEnabledTransports(
		destinationId: string,
		eventType: string
	): Promise<Array<NotificationConfig>>
	getNotificationConfigByType(
		destinationId: string,
		notificationType: string
	): Promise<NotificationConfig | null>
}

export interface ExecutionOptions {
	parallel?: boolean
	transportTypes?: string[]
}

export interface ExecutionResult {
	transportType: string
	result: NotificationTransportResult
}

export class NotificationTransportExecutor {
	constructor(
		private registry: NotificationTransportRegistry,
		private configService: NotificationConfigService,
		private env: Record<string, unknown>
	) {}

	/** Execute all enabled transports for a destination/event */
	async send(
		destinationId: string,
		notification: Notification,
		options?: ExecutionOptions
	): Promise<ExecutionResult[]> {
		// Get enabled transports for this destination and event type
		const enabledConfigs = await this.configService.getEnabledTransports(
			destinationId,
			notification.type
		)

		if (enabledConfigs.length === 0) {
			return []
		}

		// Filter by transport types if specified
		const transportTypes = options?.transportTypes
		const configsToUse = transportTypes
			? enabledConfigs.filter((config) =>
					transportTypes.includes(config.notificationType)
			  )
			: enabledConfigs

		// Execute transports
		const executeParallel = options?.parallel !== false

		if (executeParallel) {
			// Execute all transports in parallel
			const results = await Promise.allSettled(
				configsToUse.map((config) =>
					this.sendToTransport(
						destinationId,
						config.notificationType,
						notification
					)
				)
			)

			return results.map((result, index) => ({
				transportType: configsToUse[index]!.notificationType,
				result:
					result.status === 'fulfilled'
						? result.value
						: {
								success: false,
								error: new Error(
									result.reason?.message || 'Unknown error'
								),
						  },
			}))
		} else {
			// Execute sequentially
			const results: ExecutionResult[] = []
			for (const config of configsToUse) {
				const result = await this.sendToTransport(
					destinationId,
					config.notificationType,
					notification
				)
				results.push({
					transportType: config.notificationType,
					result,
				})
			}
			return results
		}
	}

	/** Execute a specific transport type with parameter validation */
	async sendToTransport(
		destinationId: string,
		transportType: string,
		notification: Notification,
		params?: Record<string, unknown>
	): Promise<NotificationTransportResult> {
		// Get transport from registry
		const transportOrConfig = this.registry.get(transportType)
		if (!transportOrConfig) {
			return {
				success: false,
				error: new Error(`Transport type '${transportType}' not found`),
			}
		}

		// Get user config for this transport
		const userConfig =
			await this.configService.getNotificationConfigByType(
				destinationId,
				transportType
			)

		// Check if transport is configured and enabled
		if (!userConfig || !userConfig.enabled) {
			return {
				success: false,
				error: new Error(
					`Transport '${transportType}' is not enabled for destination '${destinationId}'`
				),
			}
		}

		const options: NotificationTransportOptions = {
			userConfig: userConfig as NotificationConfig,
		}

		// Check if it's an internal transport or external config
		if ('send' in transportOrConfig) {
			// Internal transport
			const transport = transportOrConfig as NotificationTransport
			try {
				// Validate parameters against schema
				const validatedParams = transport.paramsSchema.parse({
					destinationId,
					notification,
					...params,
				})

				// Execute transport
				return await transport.send(validatedParams, options)
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error
							? error
							: new Error(String(error)),
				}
			}
		} else {
			// External transport config
			const config = transportOrConfig as ExternalTransportConfig
			try {
				// Validate parameters against schema
				const validatedParams = config.paramsSchema.parse({
					destinationId,
					notification,
					...params,
				})

				// Execute external transport
				return await this.executeExternalTransport(
					transportType,
					config,
					validatedParams,
					options
				)
			} catch (error) {
				return {
					success: false,
					error:
						error instanceof Error
							? error
							: new Error(String(error)),
				}
			}
		}
	}

	/** Execute an external transport (service, DO, queue, workflow, webhook) */
	private async executeExternalTransport(
		type: string,
		config: ExternalTransportConfig,
		validatedParams: unknown,
		options: NotificationTransportOptions
	): Promise<NotificationTransportResult> {
		switch (config.kind) {
			case 'service': {
				return executeServiceBindingTransport(
					this.env[config.binding] as Fetcher,
					validatedParams
				)
			}
			case 'durable-object': {
				const namespace =
					this.env[config.binding] as DurableObjectNamespace
				return executeDurableObjectTransport(
					namespace,
					validatedParams
				)
			}
			case 'queue': {
				const queue = this.env[config.binding] as Queue
				return executeQueueTransport(queue, validatedParams)
			}
			case 'workflow': {
				const workflow =
					this.env[config.binding] as Workflow
				return executeWorkflowTransport(workflow, validatedParams)
			}
			case 'webhook': {
				const url = await config.getUrl(
					(validatedParams as { destinationId: string }).destinationId,
					options.userConfig!
				)
				if (!url) {
					return {
						success: false,
						error: new Error(
							`Webhook URL not configured for transport '${type}'`
						),
					}
				}
				return executeWebhookTransport(url, validatedParams)
			}
			default: {
				const _exhaustive: never = config
				return {
					success: false,
					error: new Error(
						`Unknown external transport kind: ${(config as { kind: string }).kind}`
					),
				}
			}
		}
	}
}

