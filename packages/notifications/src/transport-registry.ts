import type {
	ExternalTransportConfig,
	NotificationTransport,
	NotificationTransportRegistry,
} from '@repo/notification-transport-base'

export class NotificationTransportRegistryImpl
	implements NotificationTransportRegistry
{
	private transports = new Map<string, NotificationTransport>()
	private externalTransports = new Map<string, ExternalTransportConfig>()

	/** Register an internal transport */
	register(transport: NotificationTransport): void {
		this.transports.set(transport.type, transport)
	}

	/** Register an external transport (service binding, DO, queue, workflow, webhook) */
	registerExternal(type: string, config: ExternalTransportConfig): void {
		this.externalTransports.set(type, config)
	}

	get(type: string): NotificationTransport | ExternalTransportConfig | undefined {
		return this.transports.get(type) ?? this.externalTransports.get(type)
	}

	getAll(): Array<NotificationTransport | ExternalTransportConfig> {
		return [...this.transports.values(), ...this.externalTransports.values()]
	}

	has(type: string): boolean {
		return this.transports.has(type) || this.externalTransports.has(type)
	}
}

