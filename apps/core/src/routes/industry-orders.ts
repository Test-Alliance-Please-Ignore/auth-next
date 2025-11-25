/**
 * Industry Order Routes
 *
 * User-facing routes for managing industry orders.
 * All routes require alliance membership.
 */

import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import {
	EntityType,
	OrderStatus,
	ServiceType,
	type Industry,
	type OrderId,
	type ServiceProviderId,
} from '@repo/industry'

import { requireAllianceMember } from '../middleware/session'
import {
	canPerformAssigneeAction,
	canPerformIssuerAction,
	canViewOrder,
	isProviderOwner,
} from '../lib/industry-order-auth'

import type { App } from '../context'

const app = new Hono<App>()

// Apply alliance member middleware to all routes
app.use('*', requireAllianceMember())

// ==========================================
// Order CRUD Routes
// ==========================================

/**
 * Create a new order
 * POST /orders
 */
app.post('/', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const bodySchema = z.object({
			title: z.string().min(1).max(255),
			description: z.string().nullable().optional(),
			orderType: z.enum(Object.values(ServiceType) as [ServiceType, ...ServiceType[]]),
			assigneeEntityId: z.string().uuid().optional(),
			assigneeEntityType: z
				.enum(Object.values(EntityType) as [EntityType, ...EntityType[]])
				.optional(),
			deliveryLocationId: z.string().optional(),
			rewardAmount: z.string().refine((val) => parseFloat(val) > 0, {
				message: 'Reward amount must be positive',
			}),
			collateralAmount: z.string().optional(),
			expiresAt: z.string().datetime().optional(),
		})

		const body = await c.req.json()
		const params = bodySchema.parse(body)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Create order with user as issuer
		const order = await stub.createOrder({
			...params,
			issuerEntityId: user.id,
			issuerEntityType: EntityType.USER,
			expiresAt: params.expiresAt ? new Date(params.expiresAt) : undefined,
		})

		logger.info('[Core] User created industry order', {
			userId: user.id,
			orderId: order.id,
			orderType: order.orderType,
		})

		return c.json(order, 201)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		logger.error('[Core] Failed to create industry order', { error })
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		return c.json({ error: 'Failed to create order' }, 500)
	}
})

/**
 * List orders (filtered by user's relationship)
 * GET /orders
 */
app.get('/', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const querySchema = z.object({
			role: z.enum(['issuer', 'assignee', 'all']).optional().default('all'),
			status: z.string().optional(),
			orderType: z.string().optional(),
			providerId: z.string().uuid().optional(),
			open: z
				.string()
				.transform((val) => val === 'true')
				.optional(),
			limit: z
				.string()
				.transform((val) => parseInt(val, 10))
				.pipe(z.number().min(1).max(100))
				.optional(),
			offset: z
				.string()
				.transform((val) => parseInt(val, 10))
				.pipe(z.number().min(0))
				.optional(),
			sortBy: z.enum(['createdAt', 'updatedAt', 'expiresAt']).optional(),
			sortDirection: z.enum(['asc', 'desc']).optional(),
		})

		const query = querySchema.parse(c.req.query())
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Parse status filter
		const statusFilter = query.status
			? (query.status.split(',') as OrderStatus[])
			: undefined

		// Parse orderType filter
		const orderTypeFilter = query.orderType
			? (query.orderType.split(',') as ServiceType[])
			: undefined

		// Build filter based on role
		let orders
		if (query.role === 'issuer') {
			orders = await stub.listOrders({
				issuerEntityId: user.id,
				issuerEntityType: EntityType.USER,
				status: statusFilter,
				orderType: orderTypeFilter,
				limit: query.limit,
				offset: query.offset,
				sortBy: query.sortBy,
				sortDirection: query.sortDirection,
			})
		} else if (query.role === 'assignee' && query.providerId) {
			// Check user owns this provider
			const ownsProvider = await isProviderOwner(
				query.providerId as ServiceProviderId,
				user.id,
				c.env
			)
			if (!ownsProvider) {
				return c.json({ error: 'Forbidden: Not provider owner' }, 403)
			}

			orders = await stub.listOrders({
				assigneeEntityId: query.providerId,
				assigneeEntityType: EntityType.SERVICE_PROVIDER,
				status: statusFilter,
				orderType: orderTypeFilter,
				limit: query.limit,
				offset: query.offset,
				sortBy: query.sortBy,
				sortDirection: query.sortDirection,
			})
		} else {
			// Get all orders where user is involved (as issuer)
			// For "all" role, we need to merge results
			const issuedOrders = await stub.listOrders({
				issuerEntityId: user.id,
				issuerEntityType: EntityType.USER,
				status: statusFilter,
				orderType: orderTypeFilter,
				limit: query.limit,
				offset: query.offset,
				sortBy: query.sortBy,
				sortDirection: query.sortDirection,
			})

			// Get user's providers and their assigned orders
			const providers = await stub.listProviders({
				ownerEntityId: user.id,
				ownerEntityType: EntityType.USER,
			})

			const assignedOrdersArrays = await Promise.all(
				providers.map((p) =>
					stub.listOrders({
						assigneeEntityId: p.id,
						assigneeEntityType: EntityType.SERVICE_PROVIDER,
						status: statusFilter,
						orderType: orderTypeFilter,
					})
				)
			)

			// Merge and dedupe
			const allOrders = [...issuedOrders]
			const seenIds = new Set(issuedOrders.map((o) => o.id))

			for (const orderList of assignedOrdersArrays) {
				for (const order of orderList) {
					if (!seenIds.has(order.id)) {
						allOrders.push(order)
						seenIds.add(order.id)
					}
				}
			}

			// Sort merged results
			allOrders.sort((a, b) => {
				const aVal = query.sortBy === 'updatedAt' ? a.updatedAt : a.createdAt
				const bVal = query.sortBy === 'updatedAt' ? b.updatedAt : b.createdAt
				const direction = query.sortDirection === 'asc' ? 1 : -1
				return direction * (new Date(aVal).getTime() - new Date(bVal).getTime())
			})

			// Apply limit/offset to merged results
			const start = query.offset || 0
			const end = start + (query.limit || 50)
			orders = allOrders.slice(start, end)
		}

		return c.json(orders)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid query parameters', details: error.issues }, 400)
		}
		logger.error('[Core] Failed to list industry orders', { error })
		return c.json({ error: 'Failed to list orders' }, 500)
	}
})

/**
 * List open orders (claimable by providers)
 * GET /orders/open
 */
app.get('/open', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const querySchema = z.object({
			orderType: z.string().optional(),
			limit: z
				.string()
				.transform((val) => parseInt(val, 10))
				.pipe(z.number().min(1).max(100))
				.optional(),
			offset: z
				.string()
				.transform((val) => parseInt(val, 10))
				.pipe(z.number().min(0))
				.optional(),
		})

		const query = querySchema.parse(c.req.query())
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		const orderTypeFilter = query.orderType
			? (query.orderType.split(',') as ServiceType[])
			: undefined

		const orders = await stub.listOrders({
			status: OrderStatus.PENDING,
			open: true,
			orderType: orderTypeFilter,
			limit: query.limit,
			offset: query.offset,
			sortBy: 'createdAt',
			sortDirection: 'desc',
		})

		return c.json(orders)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid query parameters', details: error.issues }, 400)
		}
		logger.error('[Core] Failed to list open industry orders', { error })
		return c.json({ error: 'Failed to list open orders' }, 500)
	}
})

/**
 * Get order details
 * GET /orders/:orderId
 */
app.get('/:orderId', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const order = await stub.getOrder(orderId)

		if (!order) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Check user can view this order
		const canView = await canViewOrder(order, user.id, c.env)
		if (!canView) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid order ID format' }, 400)
		}
		logger.error('[Core] Failed to get industry order', { error })
		return c.json({ error: 'Failed to get order' }, 500)
	}
})

/**
 * Get order status history
 * GET /orders/:orderId/history
 */
app.get('/:orderId/history', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const order = await stub.getOrder(orderId)

		if (!order) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Check user can view this order
		const canView = await canViewOrder(order, user.id, c.env)
		if (!canView) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		const history = await stub.getOrderHistory(orderId)
		return c.json(history)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid order ID format' }, 400)
		}
		logger.error('[Core] Failed to get order history', { error })
		return c.json({ error: 'Failed to get order history' }, 500)
	}
})

// ==========================================
// Order State Transition Routes
// ==========================================

/**
 * Claim an open order (provider becomes assignee)
 * POST /orders/:orderId/claim
 */
app.post('/:orderId/claim', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const bodySchema = z.object({
			providerId: z.string().uuid(),
		})

		const body = await c.req.json()
		const { providerId } = bodySchema.parse(body)

		// Verify user owns this provider
		const ownsProvider = await isProviderOwner(providerId as ServiceProviderId, user.id, c.env)
		if (!ownsProvider) {
			return c.json({ error: 'Forbidden: Not provider owner' }, 403)
		}

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const order = await stub.claimOrder(
			orderId,
			providerId as ServiceProviderId,
			user.id,
			EntityType.USER
		)

		logger.info('[Core] User claimed industry order', {
			userId: user.id,
			orderId,
			providerId,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error) {
			if (error.message.includes('not found')) {
				return c.json({ error: 'Order not found' }, 404)
			}
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to claim industry order', { error })
		return c.json({ error: 'Failed to claim order' }, 500)
	}
})

/**
 * Accept an order (assignee accepts work)
 * POST /orders/:orderId/accept
 */
app.post('/:orderId/accept', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const existingOrder = await stub.getOrder(orderId)

		if (!existingOrder) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Check user is assignee
		const canAccept = await canPerformAssigneeAction(existingOrder, user.id, c.env)
		if (!canAccept) {
			return c.json({ error: 'Forbidden: Not order assignee' }, 403)
		}

		const order = await stub.acceptOrder(orderId, user.id, EntityType.USER)

		logger.info('[Core] User accepted industry order', {
			userId: user.id,
			orderId,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid order ID format' }, 400)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to accept industry order', { error })
		return c.json({ error: 'Failed to accept order' }, 500)
	}
})

/**
 * Reject an order (assignee declines)
 * POST /orders/:orderId/reject
 */
app.post('/:orderId/reject', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const bodySchema = z.object({
			reason: z.string().optional(),
		})

		const body = await c.req.json().catch(() => ({}))
		const { reason } = bodySchema.parse(body)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const existingOrder = await stub.getOrder(orderId)

		if (!existingOrder) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Check user is assignee
		const canReject = await canPerformAssigneeAction(existingOrder, user.id, c.env)
		if (!canReject) {
			return c.json({ error: 'Forbidden: Not order assignee' }, 403)
		}

		const order = await stub.rejectOrder(orderId, user.id, EntityType.USER, reason)

		logger.info('[Core] User rejected industry order', {
			userId: user.id,
			orderId,
			reason,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to reject industry order', { error })
		return c.json({ error: 'Failed to reject order' }, 500)
	}
})

/**
 * Update order status (provider workflow)
 * PATCH /orders/:orderId/status
 */
app.patch('/:orderId/status', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const bodySchema = z.object({
			status: z.enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]]),
		})

		const body = await c.req.json()
		const { status } = bodySchema.parse(body)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const existingOrder = await stub.getOrder(orderId)

		if (!existingOrder) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Check user is assignee (for workflow transitions)
		const canUpdate = await canPerformAssigneeAction(existingOrder, user.id, c.env)
		if (!canUpdate) {
			return c.json({ error: 'Forbidden: Not order assignee' }, 403)
		}

		const order = await stub.updateOrderStatus(orderId, status, user.id, EntityType.USER)

		logger.info('[Core] User updated industry order status', {
			userId: user.id,
			orderId,
			newStatus: status,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to update industry order status', { error })
		return c.json({ error: 'Failed to update order status' }, 500)
	}
})

/**
 * Cancel an order
 * POST /orders/:orderId/cancel
 */
app.post('/:orderId/cancel', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const bodySchema = z.object({
			reason: z.string().optional(),
		})

		const body = await c.req.json().catch(() => ({}))
		const { reason } = bodySchema.parse(body)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const existingOrder = await stub.getOrder(orderId)

		if (!existingOrder) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Check user is either issuer or assignee
		const isIssuer = canPerformIssuerAction(existingOrder, user.id)
		const isAssignee = await canPerformAssigneeAction(existingOrder, user.id, c.env)

		if (!isIssuer && !isAssignee) {
			return c.json({ error: 'Forbidden: Not order issuer or assignee' }, 403)
		}

		const order = await stub.cancelOrder(orderId, user.id, EntityType.USER, reason)

		logger.info('[Core] User cancelled industry order', {
			userId: user.id,
			orderId,
			reason,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to cancel industry order', { error })
		return c.json({ error: 'Failed to cancel order' }, 500)
	}
})

/**
 * Confirm delivery
 * POST /orders/:orderId/confirm
 */
app.post('/:orderId/confirm', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const existingOrder = await stub.getOrder(orderId)

		if (!existingOrder) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Either issuer or assignee can confirm delivery
		const isIssuer = canPerformIssuerAction(existingOrder, user.id)
		const isAssignee = await canPerformAssigneeAction(existingOrder, user.id, c.env)

		if (!isIssuer && !isAssignee) {
			return c.json({ error: 'Forbidden: Not order issuer or assignee' }, 403)
		}

		const order = await stub.confirmDelivery(orderId, user.id, EntityType.USER)

		logger.info('[Core] User confirmed industry order delivery', {
			userId: user.id,
			orderId,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid order ID format' }, 400)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to confirm delivery', { error })
		return c.json({ error: 'Failed to confirm delivery' }, 500)
	}
})

/**
 * Complete an order (issuer finalizes)
 * POST /orders/:orderId/complete
 */
app.post('/:orderId/complete', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const orderId = c.req.param('orderId') as OrderId
		z.uuid().parse(orderId)

		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')
		const existingOrder = await stub.getOrder(orderId)

		if (!existingOrder) {
			return c.json({ error: 'Order not found' }, 404)
		}

		// Only issuer can complete
		if (!canPerformIssuerAction(existingOrder, user.id)) {
			return c.json({ error: 'Forbidden: Only issuer can complete order' }, 403)
		}

		const order = await stub.completeOrder(orderId, user.id, EntityType.USER)

		logger.info('[Core] User completed industry order', {
			userId: user.id,
			orderId,
		})

		return c.json(order)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid order ID format' }, 400)
		}
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		logger.error('[Core] Failed to complete industry order', { error })
		return c.json({ error: 'Failed to complete order' }, 500)
	}
})

export default app
