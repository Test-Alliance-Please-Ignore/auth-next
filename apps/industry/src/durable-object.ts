import { DurableObject } from 'cloudflare:workers'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { ProviderService } from './services/providers'

import type {
	ContactType,
	CreateProviderParams,
	Industry,
	ProviderContact,
	ProviderFilters,
	ProviderServiceDTO,
	ProviderStatistics,
	ServiceProvider,
	ServiceProviderId,
	ServiceStatus,
	ServiceType,
	UpdateProviderParams,
} from '@repo/industry'
import type { Env } from './context'

/**
 * Industry Durable Object
 *
 * This Durable Object uses PostgreSQL storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - PostgreSQL storage via Drizzle ORM
 */
export class IndustryDO extends DurableObject<Env, {}> implements Industry {
	private db: ReturnType<typeof createDb>
	private providerService: ProviderService

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		// Initialize database client
		this.db = createDb(env.DATABASE_URL)

		// Initialize services
		this.providerService = new ProviderService({ db: this.db, env })
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade handling
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Accept the WebSocket connection using hibernation API
			this.ctx.acceptWebSocket(server)

			return new Response(null, {
				status: 101,
				webSocket: client,
			})
		}

		return new Response('Industry Durable Object', { status: 200 })
	}

	// ==========================================
	// Provider Management RPC Methods
	// ==========================================

	/**
	 * Create a new service provider
	 */
	async createProvider(
		params: CreateProviderParams,
		adminUserId: string
	): Promise<ServiceProvider> {
		logger.info('[Industry] Admin creating provider', {
			adminUserId,
			providerName: params.name,
			ownerEntityId: params.ownerEntityId,
			ownerEntityType: params.ownerEntityType,
		})

		const provider = await this.providerService.createProvider(params)

		logger.info('[Industry] Provider created successfully', {
			adminUserId,
			providerId: provider.id,
			providerName: provider.name,
		})

		return provider
	}

	/**
	 * Get a provider by ID
	 */
	async getProvider(providerId: ServiceProviderId): Promise<ServiceProvider> {
		return this.providerService.getProvider(providerId)
	}

	/**
	 * List providers with filters
	 */
	async listProviders(filters: ProviderFilters): Promise<ServiceProvider[]> {
		return this.providerService.listProviders(filters)
	}

	/**
	 * Update provider details
	 */
	async updateProvider(
		providerId: ServiceProviderId,
		params: UpdateProviderParams,
		adminUserId: string
	): Promise<ServiceProvider> {
		logger.info('[Industry] Admin updating provider', {
			adminUserId,
			providerId,
			updates: params,
		})

		const provider = await this.providerService.updateProvider(providerId, params)

		logger.info('[Industry] Provider updated successfully', {
			adminUserId,
			providerId,
			providerName: provider.name,
		})

		return provider
	}

	/**
	 * Delete a provider
	 */
	async deleteProvider(providerId: ServiceProviderId, adminUserId: string): Promise<void> {
		logger.info('[Industry] Admin deleting provider', {
			adminUserId,
			providerId,
		})

		await this.providerService.deleteProvider(providerId)

		logger.info('[Industry] Provider deleted successfully', {
			adminUserId,
			providerId,
		})
	}

	/**
	 * Set provider accepting orders status
	 */
	async setAcceptingOrders(
		providerId: ServiceProviderId,
		acceptingOrders: boolean,
		adminUserId: string
	): Promise<ServiceProvider> {
		logger.info('[Industry] Admin setting accepting orders status', {
			adminUserId,
			providerId,
			acceptingOrders,
		})

		const provider = await this.providerService.setAcceptingOrders(providerId, acceptingOrders)

		logger.info('[Industry] Accepting orders status updated', {
			adminUserId,
			providerId,
			acceptingOrders: provider.acceptingOrders,
		})

		return provider
	}

	// ==========================================
	// Service Management RPC Methods
	// ==========================================

	/**
	 * Add a service type to a provider
	 */
	async addService(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		adminUserId: string
	): Promise<ProviderServiceDTO> {
		logger.info('[Industry] Admin adding service to provider', {
			adminUserId,
			providerId,
			serviceType,
		})

		const service = await this.providerService.addService(providerId, serviceType)

		logger.info('[Industry] Service added successfully', {
			adminUserId,
			providerId,
			serviceType,
			serviceId: service.id,
		})

		return service
	}

	/**
	 * Remove a service type from a provider
	 */
	async removeService(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		adminUserId: string
	): Promise<void> {
		logger.info('[Industry] Admin removing service from provider', {
			adminUserId,
			providerId,
			serviceType,
		})

		await this.providerService.removeService(providerId, serviceType)

		logger.info('[Industry] Service removed successfully', {
			adminUserId,
			providerId,
			serviceType,
		})
	}

	/**
	 * Update service status
	 */
	async updateServiceStatus(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		status: ServiceStatus,
		adminUserId: string
	): Promise<ProviderServiceDTO> {
		logger.info('[Industry] Admin updating service status', {
			adminUserId,
			providerId,
			serviceType,
			status,
		})

		const service = await this.providerService.updateServiceStatus(providerId, serviceType, status)

		logger.info('[Industry] Service status updated successfully', {
			adminUserId,
			providerId,
			serviceType,
			status: service.status,
		})

		return service
	}

	/**
	 * List all services for a provider
	 */
	async listProviderServices(providerId: ServiceProviderId): Promise<ProviderServiceDTO[]> {
		return this.providerService.listProviderServices(providerId)
	}

	// ==========================================
	// Contact Management RPC Methods
	// ==========================================

	/**
	 * Add a contact to a provider
	 */
	async addContact(
		providerId: ServiceProviderId,
		contactType: ContactType,
		adminUserId: string
	): Promise<ProviderContact> {
		logger.info('[Industry] Admin adding contact to provider', {
			adminUserId,
			providerId,
			contactType,
		})

		const contact = await this.providerService.addContact(providerId, contactType)

		logger.info('[Industry] Contact added successfully', {
			adminUserId,
			providerId,
			contactType,
			contactId: contact.id,
		})

		return contact
	}

	/**
	 * Remove a contact
	 */
	async removeContact(contactId: string, adminUserId: string): Promise<void> {
		logger.info('[Industry] Admin removing contact', {
			adminUserId,
			contactId,
		})

		await this.providerService.removeContact(contactId)

		logger.info('[Industry] Contact removed successfully', {
			adminUserId,
			contactId,
		})
	}

	/**
	 * List all contacts for a provider
	 */
	async listProviderContacts(providerId: ServiceProviderId): Promise<ProviderContact[]> {
		return this.providerService.listProviderContacts(providerId)
	}

	// ==========================================
	// Statistics RPC Methods
	// ==========================================

	/**
	 * Get provider statistics
	 */
	async getProviderStats(): Promise<ProviderStatistics> {
		return this.providerService.getProviderStats()
	}
}
