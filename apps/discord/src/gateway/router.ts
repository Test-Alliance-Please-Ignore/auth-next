import { logger } from '@repo/hono-helpers'

import type { DiscordGatewayEventRegistry } from './registry'
import type { DiscordGatewayContext, DiscordGatewayEnvelope } from './types'

export interface DiscordGatewayRouteResult {
	handled: boolean
	eventName: string | null
}

export class DiscordGatewayEventRouter {
	constructor(private readonly registry: DiscordGatewayEventRegistry) {}

	async route(
		envelope: DiscordGatewayEnvelope,
		handlerContext: DiscordGatewayContext
	): Promise<DiscordGatewayRouteResult> {
		if (envelope.op !== 0 || !envelope.t) {
			return { handled: false, eventName: envelope.t }
		}

		const handler = this.registry.get(envelope.t)
		if (!handler) {
			logger.debug('[DiscordGateway] No event handler registered', {
				eventName: envelope.t,
				sequence: envelope.s,
			})
			return { handled: false, eventName: envelope.t }
		}

		await handler.handle({
			...handlerContext,
			eventName: envelope.t,
			payload: envelope.d,
			sequence: envelope.s,
		})

		return { handled: true, eventName: envelope.t }
	}
}
