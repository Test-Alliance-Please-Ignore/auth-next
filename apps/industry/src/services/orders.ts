import { and, asc, desc, eq, inArray, isNull } from '@repo/db-utils'
import { EntityType, isValidOrderTransition, OrderStatus, ServiceStatus } from '@repo/industry'

import { orders, orderStatusHistory, providerServices, serviceProviders } from '../db/schema'

import type {
	ActorInfo,
	CreateOrderParams,
	IndustryOrder,
	OrderFilters,
	OrderId,
	OrderStatusHistoryEntry,
	ServiceProviderId,
	ServiceType,
} from '@repo/industry'
import type { ServiceContext } from './context'

/**
 * Order Service
 *
 * Manages industry orders and their lifecycle.
 */
export class OrderService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * Create a new order
	 */
	async createOrder(params: CreateOrderParams): Promise<IndustryOrder> {
		// Validate required fields
		if (!params.title?.trim()) {
			throw new Error('Order title is required')
		}

		if (!params.rewardAmount || parseFloat(params.rewardAmount) <= 0) {
			throw new Error('Reward amount must be positive')
		}

		if (params.expiresAt && new Date(params.expiresAt) <= new Date()) {
			throw new Error('Expiration date must be in the future')
		}

		// If assignee is specified, validate the provider exists and offers this service
		if (params.assigneeEntityId && params.assigneeEntityType === EntityType.SERVICE_PROVIDER) {
			await this.validateAssigneeCanFulfill(
				params.assigneeEntityId as ServiceProviderId,
				params.orderType
			)
		}

		const [order] = await this.ctx.db
			.insert(orders)
			.values({
				title: params.title.trim(),
				description: params.description ?? null,
				orderType: params.orderType,
				issuerEntityId: params.issuerEntityId,
				issuerEntityType: params.issuerEntityType,
				assigneeEntityId: params.assigneeEntityId ?? null,
				assigneeEntityType: params.assigneeEntityType ?? null,
				deliveryLocationId: params.deliveryLocationId ?? null,
				rewardAmount: params.rewardAmount,
				collateralAmount: params.collateralAmount ?? '0',
				expiresAt: params.expiresAt ?? null,
				status: OrderStatus.PENDING,
			})
			.returning()

		if (!order) {
			throw new Error('Failed to create order')
		}

		return this.mapToOrder(order)
	}

	/**
	 * Get a single order by ID
	 */
	async getOrder(orderId: OrderId): Promise<IndustryOrder | null> {
		const order = await this.ctx.db.query.orders.findFirst({
			where: eq(orders.id, orderId),
		})

		if (!order) {
			return null
		}

		return this.mapToOrder(order)
	}

	/**
	 * List orders with optional filters
	 */
	async listOrders(filters: OrderFilters = {}): Promise<IndustryOrder[]> {
		const conditions: Array<ReturnType<typeof eq>> = []

		// Status filter
		if (filters.status) {
			if (Array.isArray(filters.status)) {
				conditions.push(inArray(orders.status, filters.status))
			} else {
				conditions.push(eq(orders.status, filters.status))
			}
		}

		// Order type filter
		if (filters.orderType) {
			if (Array.isArray(filters.orderType)) {
				conditions.push(inArray(orders.orderType, filters.orderType))
			} else {
				conditions.push(eq(orders.orderType, filters.orderType))
			}
		}

		// Issuer filters
		if (filters.issuerEntityId) {
			conditions.push(eq(orders.issuerEntityId, filters.issuerEntityId))
		}
		if (filters.issuerEntityType) {
			conditions.push(eq(orders.issuerEntityType, filters.issuerEntityType))
		}

		// Assignee filters
		if (filters.assigneeEntityId) {
			conditions.push(eq(orders.assigneeEntityId, filters.assigneeEntityId))
		}
		if (filters.assigneeEntityType) {
			conditions.push(eq(orders.assigneeEntityType, filters.assigneeEntityType))
		}

		// Open orders (no assignee)
		if (filters.open) {
			conditions.push(isNull(orders.assigneeEntityId))
		}

		// Determine sort order
		const sortColumn =
			filters.sortBy === 'updatedAt'
				? orders.updatedAt
				: filters.sortBy === 'expiresAt'
					? orders.expiresAt
					: orders.createdAt

		const orderBy = filters.sortDirection === 'asc' ? asc(sortColumn) : desc(sortColumn)

		const results = await this.ctx.db.query.orders.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [orderBy],
			limit: filters.limit || 50,
			offset: filters.offset || 0,
		})

		return results.map((order) => this.mapToOrder(order))
	}

	/**
	 * Get order status history
	 */
	async getOrderHistory(orderId: OrderId): Promise<OrderStatusHistoryEntry[]> {
		const history = await this.ctx.db.query.orderStatusHistory.findMany({
			where: eq(orderStatusHistory.orderId, orderId),
			orderBy: [desc(orderStatusHistory.createdAt)],
		})

		return history.map((entry) => this.mapToHistoryEntry(entry))
	}

	/**
	 * Claim an open order (sets provider as assignee)
	 */
	async claimOrder(
		orderId: OrderId,
		providerId: ServiceProviderId,
		_actor: ActorInfo
	): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Must be PENDING and have no assignee
		if (order.status !== OrderStatus.PENDING) {
			throw new Error('Only pending orders can be claimed')
		}
		if (order.assigneeEntityId) {
			throw new Error('Order already has an assignee')
		}

		// Validate provider can fulfill this order type
		await this.validateAssigneeCanFulfill(providerId, order.orderType)

		// Update order with assignee
		const [updated] = await this.ctx.db
			.update(orders)
			.set({
				assigneeEntityId: providerId,
				assigneeEntityType: EntityType.SERVICE_PROVIDER,
				updatedAt: new Date(),
			})
			.where(eq(orders.id, orderId))
			.returning()

		if (!updated) {
			throw new Error('Failed to claim order')
		}

		return this.mapToOrder(updated)
	}

	/**
	 * Accept an order (assignee accepts work)
	 */
	async acceptOrder(orderId: OrderId, actor: ActorInfo): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Must be PENDING
		if (order.status !== OrderStatus.PENDING) {
			throw new Error('Only pending orders can be accepted')
		}

		// Must have an assignee
		if (!order.assigneeEntityId) {
			throw new Error('Order must be claimed before accepting')
		}

		// Validate actor is assignee
		this.validateIsAssignee(order, actor)

		return this.transitionStatus(orderId, order, OrderStatus.ACCEPTED, actor)
	}

	/**
	 * Reject an order (assignee declines)
	 */
	async rejectOrder(orderId: OrderId, actor: ActorInfo, _reason?: string): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Must be PENDING
		if (order.status !== OrderStatus.PENDING) {
			throw new Error('Only pending orders can be rejected')
		}

		// Must have an assignee
		if (!order.assigneeEntityId) {
			throw new Error('Order has no assignee to reject')
		}

		// Validate actor is assignee
		this.validateIsAssignee(order, actor)

		// Rejecting removes assignee and keeps PENDING
		const [updated] = await this.ctx.db
			.update(orders)
			.set({
				assigneeEntityId: null,
				assigneeEntityType: null,
				rejectedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(orders.id, orderId))
			.returning()

		if (!updated) {
			throw new Error('Failed to reject order')
		}

		return this.mapToOrder(updated)
	}

	/**
	 * Update order status (general transition for provider workflow)
	 */
	async updateOrderStatus(
		orderId: OrderId,
		newStatus: OrderStatus,
		actor: ActorInfo
	): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Validate transition is allowed
		if (!isValidOrderTransition(order.status, newStatus)) {
			throw new Error(`Cannot transition from ${order.status} to ${newStatus}`)
		}

		// Validate actor permissions based on transition
		this.validateTransitionPermission(order, newStatus, actor)

		return this.transitionStatus(orderId, order, newStatus, actor)
	}

	/**
	 * Cancel an order
	 */
	async cancelOrder(orderId: OrderId, actor: ActorInfo, _reason?: string): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Cannot cancel terminal states
		if (
			order.status === OrderStatus.COMPLETED ||
			order.status === OrderStatus.CANCELLED ||
			order.status === OrderStatus.EXPIRED
		) {
			throw new Error('Cannot cancel an order in terminal state')
		}

		// Both issuer and assignee can cancel (with different rules)
		const isIssuer = this.isIssuer(order, actor)
		const isAssignee = this.isAssignee(order, actor)

		if (!isIssuer && !isAssignee) {
			throw new Error('Only the issuer or assignee can cancel an order')
		}

		// Issuer can only cancel PENDING orders
		if (isIssuer && !isAssignee && order.status !== OrderStatus.PENDING) {
			throw new Error('Issuer can only cancel pending orders')
		}

		return this.transitionStatus(orderId, order, OrderStatus.CANCELLED, actor)
	}

	/**
	 * Confirm delivery
	 */
	async confirmDelivery(orderId: OrderId, actor: ActorInfo): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Must be IN_TRANSIT
		if (order.status !== OrderStatus.IN_TRANSIT) {
			throw new Error('Can only confirm delivery for orders in transit')
		}

		// Either party can confirm delivery
		const isIssuer = this.isIssuer(order, actor)
		const isAssignee = this.isAssignee(order, actor)

		if (!isIssuer && !isAssignee) {
			throw new Error('Only the issuer or assignee can confirm delivery')
		}

		return this.transitionStatus(orderId, order, OrderStatus.DELIVERED, actor)
	}

	/**
	 * Complete an order (issuer finalizes)
	 */
	async completeOrder(orderId: OrderId, actor: ActorInfo): Promise<IndustryOrder> {
		const order = await this.getOrderOrThrow(orderId)

		// Must be DELIVERED
		if (order.status !== OrderStatus.DELIVERED) {
			throw new Error('Can only complete delivered orders')
		}

		// Only issuer can complete
		if (!this.isIssuer(order, actor)) {
			throw new Error('Only the issuer can complete an order')
		}

		return this.transitionStatus(orderId, order, OrderStatus.COMPLETED, actor)
	}

	// =========================================================================
	// Private Helpers
	// =========================================================================

	/**
	 * Get order or throw if not found
	 */
	private async getOrderOrThrow(orderId: OrderId): Promise<IndustryOrder> {
		const order = await this.getOrder(orderId)
		if (!order) {
			throw new Error('Order not found')
		}
		return order
	}

	/**
	 * Validate that a provider can fulfill an order type
	 */
	private async validateAssigneeCanFulfill(
		providerId: ServiceProviderId,
		orderType: ServiceType
	): Promise<void> {
		// Check provider exists and is accepting orders
		const provider = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!provider) {
			throw new Error('Service provider not found')
		}

		if (!provider.acceptingOrders) {
			throw new Error('Service provider is not accepting orders')
		}

		// Check provider offers this service type and it's active
		const service = await this.ctx.db.query.providerServices.findFirst({
			where: and(
				eq(providerServices.providerId, providerId),
				eq(providerServices.serviceType, orderType),
				eq(providerServices.status, ServiceStatus.ACTIVE)
			),
		})

		if (!service) {
			throw new Error('Service provider does not offer this service type or it is not active')
		}
	}

	/**
	 * Check if actor is the issuer
	 */
	private isIssuer(order: IndustryOrder, actor: ActorInfo): boolean {
		return order.issuerEntityId === actor.entityId && order.issuerEntityType === actor.entityType
	}

	/**
	 * Check if actor is the assignee
	 */
	private isAssignee(order: IndustryOrder, actor: ActorInfo): boolean {
		return (
			order.assigneeEntityId === actor.entityId && order.assigneeEntityType === actor.entityType
		)
	}

	/**
	 * Validate actor is assignee or throw
	 */
	private validateIsAssignee(order: IndustryOrder, actor: ActorInfo): void {
		if (!this.isAssignee(order, actor)) {
			throw new Error('Only the assignee can perform this action')
		}
	}

	/**
	 * Validate actor has permission for transition
	 */
	private validateTransitionPermission(
		order: IndustryOrder,
		newStatus: OrderStatus,
		actor: ActorInfo
	): void {
		const isIssuer = this.isIssuer(order, actor)
		const isAssignee = this.isAssignee(order, actor)

		// Provider workflow transitions (assignee only)
		const assigneeOnlyTransitions = [
			OrderStatus.ACCEPTED,
			OrderStatus.IN_PRODUCTION,
			OrderStatus.READY_FOR_DELIVERY,
			OrderStatus.IN_TRANSIT,
		]

		if (assigneeOnlyTransitions.includes(newStatus)) {
			if (!isAssignee) {
				throw new Error('Only the assignee can perform this transition')
			}
			return
		}

		// DELIVERED can be confirmed by either party
		if (newStatus === OrderStatus.DELIVERED) {
			if (!isIssuer && !isAssignee) {
				throw new Error('Only the issuer or assignee can confirm delivery')
			}
			return
		}

		// COMPLETED is issuer only
		if (newStatus === OrderStatus.COMPLETED) {
			if (!isIssuer) {
				throw new Error('Only the issuer can complete an order')
			}
			return
		}

		// CANCELLED handled separately in cancelOrder
	}

	/**
	 * Transition order status with audit trail
	 */
	private async transitionStatus(
		orderId: OrderId,
		order: IndustryOrder,
		newStatus: OrderStatus,
		actor: ActorInfo
	): Promise<IndustryOrder> {
		const now = new Date()

		// Build update object
		const updates: Partial<typeof orders.$inferInsert> = {
			status: newStatus,
			updatedAt: now,
		}

		// Set status-specific timestamps
		if (newStatus === OrderStatus.ACCEPTED) {
			updates.acceptedAt = now
		} else if (newStatus === OrderStatus.COMPLETED) {
			updates.completedAt = now
		} else if (newStatus === OrderStatus.CANCELLED) {
			updates.cancelledAt = now
		}

		// Update order and create history in parallel
		const [[updated]] = await Promise.all([
			this.ctx.db.update(orders).set(updates).where(eq(orders.id, orderId)).returning(),
			this.ctx.db.insert(orderStatusHistory).values({
				orderId,
				previousStatus: order.status,
				newStatus,
				actorEntityId: actor.entityId,
				actorEntityType: actor.entityType,
			}),
		])

		if (!updated) {
			throw new Error('Failed to update order status')
		}

		return this.mapToOrder(updated)
	}

	/**
	 * Map database record to IndustryOrder DTO
	 */
	private mapToOrder(order: typeof orders.$inferSelect): IndustryOrder {
		return {
			id: order.id as OrderId,
			title: order.title,
			description: order.description,
			status: order.status as OrderStatus,
			orderType: order.orderType as ServiceType,
			issuerEntityId: order.issuerEntityId,
			issuerEntityType: order.issuerEntityType as EntityType,
			assigneeEntityId: order.assigneeEntityId,
			assigneeEntityType: order.assigneeEntityType as EntityType | null,
			eveContractId: order.eveContractId,
			deliveryLocationId: order.deliveryLocationId,
			rewardAmount: order.rewardAmount,
			collateralAmount: order.collateralAmount ?? '0',
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
			acceptedAt: order.acceptedAt,
			completedAt: order.completedAt,
			expiresAt: order.expiresAt,
			cancelledAt: order.cancelledAt,
			rejectedAt: order.rejectedAt,
			refundedAt: order.refundedAt,
		}
	}

	/**
	 * Map database record to OrderStatusHistoryEntry DTO
	 */
	private mapToHistoryEntry(
		entry: typeof orderStatusHistory.$inferSelect
	): OrderStatusHistoryEntry {
		return {
			id: entry.id,
			orderId: entry.orderId as OrderId,
			previousStatus: entry.previousStatus as OrderStatus,
			newStatus: entry.newStatus as OrderStatus,
			actorEntityId: entry.actorEntityId,
			actorEntityType: entry.actorEntityType as EntityType,
			createdAt: entry.createdAt,
		}
	}
}
