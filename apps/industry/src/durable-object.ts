import { DurableObject } from 'cloudflare:workers'
import { logger } from '@repo/hono-helpers'

import { createDb } from './db'
import { OrderService } from './services/orders'
import { ProviderService } from './services/providers'

import type {
	ContactType,
	CreateOrderParams,
	CreateProviderParams,
	EntityType,
	Industry,
	IndustryOrder,
	OrderFilters,
	OrderId,
	OrderStatus,
	OrderStatusHistoryEntry,
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
	private orderService: OrderService

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
		this.orderService = new OrderService({ db: this.db, env })
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

	// ==========================================
	// Order Management RPC Methods
	// ==========================================

	/**
	 * Create a new order
	 */
	async createOrder(params: CreateOrderParams): Promise<IndustryOrder> {
		logger.info('[Industry] Creating order', {
			title: params.title,
			orderType: params.orderType,
			issuerEntityId: params.issuerEntityId,
			assigneeEntityId: params.assigneeEntityId,
		})

		const order = await this.orderService.createOrder(params)

		logger.info('[Industry] Order created successfully', {
			orderId: order.id,
			title: order.title,
			orderType: order.orderType,
		})

		return order
	}

	/**
	 * Get an order by ID
	 */
	async getOrder(orderId: OrderId): Promise<IndustryOrder | null> {
		return this.orderService.getOrder(orderId)
	}

	/**
	 * List orders with filters
	 */
	async listOrders(filters: OrderFilters): Promise<IndustryOrder[]> {
		return this.orderService.listOrders(filters)
	}

	/**
	 * Get order status history
	 */
	async getOrderHistory(orderId: OrderId): Promise<OrderStatusHistoryEntry[]> {
		return this.orderService.getOrderHistory(orderId)
	}

	// ==========================================
	// Order State Transition RPC Methods
	// ==========================================

	/**
	 * Claim an open order (provider becomes assignee)
	 */
	async claimOrder(
		orderId: OrderId,
		providerId: ServiceProviderId,
		actorEntityId: string,
		actorEntityType: EntityType
	): Promise<IndustryOrder> {
		logger.info('[Industry] Claiming order', {
			orderId,
			providerId,
			actorEntityId,
			actorEntityType,
		})

		const order = await this.orderService.claimOrder(orderId, providerId, {
			entityId: actorEntityId,
			entityType: actorEntityType,
		})

		logger.info('[Industry] Order claimed successfully', {
			orderId,
			providerId,
			newAssigneeEntityId: order.assigneeEntityId,
		})

		return order
	}

	/**
	 * Accept an order (assignee accepts work)
	 */
	async acceptOrder(
		orderId: OrderId,
		actorEntityId: string,
		actorEntityType: EntityType
	): Promise<IndustryOrder> {
		logger.info('[Industry] Accepting order', {
			orderId,
			actorEntityId,
			actorEntityType,
		})

		const order = await this.orderService.acceptOrder(orderId, {
			entityId: actorEntityId,
			entityType: actorEntityType,
		})

		logger.info('[Industry] Order accepted successfully', {
			orderId,
			status: order.status,
		})

		return order
	}

	/**
	 * Reject an order (assignee declines)
	 */
	async rejectOrder(
		orderId: OrderId,
		actorEntityId: string,
		actorEntityType: EntityType,
		reason?: string
	): Promise<IndustryOrder> {
		logger.info('[Industry] Rejecting order', {
			orderId,
			actorEntityId,
			actorEntityType,
			reason,
		})

		const order = await this.orderService.rejectOrder(
			orderId,
			{
				entityId: actorEntityId,
				entityType: actorEntityType,
			},
			reason
		)

		logger.info('[Industry] Order rejected successfully', {
			orderId,
			newAssigneeEntityId: order.assigneeEntityId,
		})

		return order
	}

	/**
	 * Update order status
	 */
	async updateOrderStatus(
		orderId: OrderId,
		status: OrderStatus,
		actorEntityId: string,
		actorEntityType: EntityType
	): Promise<IndustryOrder> {
		logger.info('[Industry] Updating order status', {
			orderId,
			newStatus: status,
			actorEntityId,
			actorEntityType,
		})

		const order = await this.orderService.updateOrderStatus(orderId, status, {
			entityId: actorEntityId,
			entityType: actorEntityType,
		})

		logger.info('[Industry] Order status updated successfully', {
			orderId,
			status: order.status,
		})

		return order
	}

	/**
	 * Cancel an order
	 */
	async cancelOrder(
		orderId: OrderId,
		actorEntityId: string,
		actorEntityType: EntityType,
		reason?: string
	): Promise<IndustryOrder> {
		logger.info('[Industry] Cancelling order', {
			orderId,
			actorEntityId,
			actorEntityType,
			reason,
		})

		const order = await this.orderService.cancelOrder(
			orderId,
			{
				entityId: actorEntityId,
				entityType: actorEntityType,
			},
			reason
		)

		logger.info('[Industry] Order cancelled successfully', {
			orderId,
			status: order.status,
		})

		return order
	}

	/**
	 * Confirm delivery
	 */
	async confirmDelivery(
		orderId: OrderId,
		actorEntityId: string,
		actorEntityType: EntityType
	): Promise<IndustryOrder> {
		logger.info('[Industry] Confirming delivery', {
			orderId,
			actorEntityId,
			actorEntityType,
		})

		const order = await this.orderService.confirmDelivery(orderId, {
			entityId: actorEntityId,
			entityType: actorEntityType,
		})

		logger.info('[Industry] Delivery confirmed successfully', {
			orderId,
			status: order.status,
		})

		return order
	}

	/**
	 * Complete an order (issuer finalizes)
	 */
	async completeOrder(
		orderId: OrderId,
		actorEntityId: string,
		actorEntityType: EntityType
	): Promise<IndustryOrder> {
		logger.info('[Industry] Completing order', {
			orderId,
			actorEntityId,
			actorEntityType,
		})

		const order = await this.orderService.completeOrder(orderId, {
			entityId: actorEntityId,
			entityType: actorEntityType,
		})

		logger.info('[Industry] Order completed successfully', {
			orderId,
			status: order.status,
		})

		return order
	}
}
