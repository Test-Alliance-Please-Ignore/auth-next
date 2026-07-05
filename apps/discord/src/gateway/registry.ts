import type { DiscordGatewayDispatchEventName, DiscordGatewayEventHandler } from './types'

export class DiscordGatewayEventRegistry {
	private readonly handlers = new Map<string, DiscordGatewayEventHandler>()

	register<T>(handler: DiscordGatewayEventHandler<T>): void {
		this.handlers.set(handler.eventName, handler as DiscordGatewayEventHandler)
	}

	get(eventName: DiscordGatewayDispatchEventName): DiscordGatewayEventHandler | undefined {
		return this.handlers.get(eventName)
	}

	list(): DiscordGatewayEventHandler[] {
		return Array.from(this.handlers.values())
	}
}

export function createDiscordGatewayEventRegistry(
	handlers: DiscordGatewayEventHandler[] = []
): DiscordGatewayEventRegistry {
	const registry = new DiscordGatewayEventRegistry()
	for (const handler of handlers) {
		registry.register(handler)
	}
	return registry
}
