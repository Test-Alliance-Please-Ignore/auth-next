import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import {
	ContactType,
	EntityType,
	ServiceStatus,
	ServiceType,
	type Industry,
	type ServiceProviderId,
} from '@repo/industry'

import { requireAdmin, requireAuth } from '../middleware/session'

import type { App } from '../context'

const app = new Hono<App>()

// ==========================================
// Provider Management Routes
// ==========================================

/**
 * Create a new service provider
 * POST /industry/providers
 */
app.post('/industry/providers', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Parse and validate request body
		const bodySchema = z.object({
			name: z.string().min(1).max(255),
			description: z.string().nullable().optional(),
			ownerEntityId: z.uuid(),
			ownerEntityType: z.enum(Object.values(EntityType) as [EntityType, ...EntityType[]]),
			acceptingOrders: z.boolean().optional(),
		})

		const body = await c.req.json()
		const params = bodySchema.parse(body)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Create provider via RPC
		const provider = await stub.createProvider(params, user.id)

		logger.info('[Core] Admin created industry provider', {
			adminUserId: user.id,
			providerId: provider.id,
			providerName: provider.name,
		})

		return c.json(provider, 201)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		logger.error('[Core] Failed to create industry provider', { error })
		return c.json({ error: 'Failed to create provider' }, 500)
	}
})

/**
 * List providers with optional filters
 * GET /industry/providers
 */
app.get('/industry/providers', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Parse query parameters
		const querySchema = z.object({
			ownerEntityId: z.uuid().optional(),
			ownerEntityType: z.enum(Object.values(EntityType) as [EntityType, ...EntityType[]]).optional(),
			acceptingOrders: z
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
		})

		const filters = querySchema.parse(c.req.query())

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// List providers via RPC
		const providers = await stub.listProviders(filters)

		return c.json(providers)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid query parameters', details: error.issues }, 400)
		}
		logger.error('[Core] Failed to list industry providers', { error })
		return c.json({ error: 'Failed to list providers' }, 500)
	}
})

/**
 * Get a specific provider by ID
 * GET /industry/providers/:providerId
 */
app.get('/industry/providers/:providerId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Get provider via RPC
		const provider = await stub.getProvider(providerId)

		return c.json(provider)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid provider ID format' }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to get industry provider', { error })
		return c.json({ error: 'Failed to get provider' }, 500)
	}
})

/**
 * Update a provider
 * PATCH /industry/providers/:providerId
 */
app.patch('/industry/providers/:providerId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Parse and validate request body
		const bodySchema = z.object({
			name: z.string().min(1).max(255).optional(),
			description: z.string().nullable().optional(),
			acceptingOrders: z.boolean().optional(),
		})

		const body = await c.req.json()
		const params = bodySchema.parse(body)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Update provider via RPC
		const provider = await stub.updateProvider(providerId, params, user.id)

		logger.info('[Core] Admin updated industry provider', {
			adminUserId: user.id,
			providerId,
			updates: params,
		})

		return c.json(provider)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to update industry provider', { error })
		return c.json({ error: 'Failed to update provider' }, 500)
	}
})

/**
 * Delete a provider
 * DELETE /industry/providers/:providerId
 */
app.delete('/industry/providers/:providerId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Delete provider via RPC
		await stub.deleteProvider(providerId, user.id)

		logger.info('[Core] Admin deleted industry provider', {
			adminUserId: user.id,
			providerId,
		})

		return c.json({ message: 'Provider deleted successfully' })
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid provider ID format' }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to delete industry provider', { error })
		return c.json({ error: 'Failed to delete provider' }, 500)
	}
})

/**
 * Toggle provider accepting orders status
 * POST /industry/providers/:providerId/accepting-orders
 */
app.post('/industry/providers/:providerId/accepting-orders', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Parse and validate request body
		const bodySchema = z.object({
			acceptingOrders: z.boolean(),
		})

		const body = await c.req.json()
		const { acceptingOrders } = bodySchema.parse(body)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Update accepting orders status via RPC
		const provider = await stub.setAcceptingOrders(providerId, acceptingOrders, user.id)

		logger.info('[Core] Admin toggled provider accepting orders', {
			adminUserId: user.id,
			providerId,
			acceptingOrders,
		})

		return c.json(provider)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to toggle provider accepting orders', { error })
		return c.json({ error: 'Failed to update provider status' }, 500)
	}
})

// ==========================================
// Service Management Routes
// ==========================================

/**
 * Add a service to a provider
 * POST /industry/providers/:providerId/services
 */
app.post('/industry/providers/:providerId/services', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Parse and validate request body
		const bodySchema = z.object({
			serviceType: z.enum(Object.values(ServiceType) as [ServiceType, ...ServiceType[]]),
		})

		const body = await c.req.json()
		const { serviceType } = bodySchema.parse(body)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Add service via RPC
		const service = await stub.addService(providerId, serviceType, user.id)

		logger.info('[Core] Admin added service to provider', {
			adminUserId: user.id,
			providerId,
			serviceType,
			serviceId: service.id,
		})

		return c.json(service, 201)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		if (error instanceof Error && error.message === 'Service type already exists for this provider') {
			return c.json({ error: 'Service already exists' }, 409)
		}
		logger.error('[Core] Failed to add service to provider', { error })
		return c.json({ error: 'Failed to add service' }, 500)
	}
})

/**
 * List services for a provider
 * GET /industry/providers/:providerId/services
 */
app.get('/industry/providers/:providerId/services', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// List services via RPC
		const services = await stub.listProviderServices(providerId)

		return c.json(services)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid provider ID format' }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to list provider services', { error })
		return c.json({ error: 'Failed to list services' }, 500)
	}
})

/**
 * Remove a service from a provider
 * DELETE /industry/providers/:providerId/services/:serviceType
 */
app.delete('/industry/providers/:providerId/services/:serviceType', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId
		const serviceType = c.req.param('serviceType') as ServiceType

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Validate service type
		const serviceTypeSchema = z.enum(Object.values(ServiceType) as [ServiceType, ...ServiceType[]])
		serviceTypeSchema.parse(serviceType)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Remove service via RPC
		await stub.removeService(providerId, serviceType, user.id)

		logger.info('[Core] Admin removed service from provider', {
			adminUserId: user.id,
			providerId,
			serviceType,
		})

		return c.json({ message: 'Service removed successfully' })
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request parameters' }, 400)
		}
		if (error instanceof Error && error.message === 'Service not found for this provider') {
			return c.json({ error: 'Service not found' }, 404)
		}
		logger.error('[Core] Failed to remove service from provider', { error })
		return c.json({ error: 'Failed to remove service' }, 500)
	}
})

/**
 * Update service status
 * PATCH /industry/providers/:providerId/services/:serviceType/status
 */
app.patch('/industry/providers/:providerId/services/:serviceType/status', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId
		const serviceType = c.req.param('serviceType') as ServiceType

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Validate service type
		const serviceTypeSchema = z.enum(Object.values(ServiceType) as [ServiceType, ...ServiceType[]])
		serviceTypeSchema.parse(serviceType)

		// Parse and validate request body
		const bodySchema = z.object({
			status: z.enum(Object.values(ServiceStatus) as [ServiceStatus, ...ServiceStatus[]]),
		})

		const body = await c.req.json()
		const { status } = bodySchema.parse(body)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Update service status via RPC
		const service = await stub.updateServiceStatus(providerId, serviceType, status, user.id)

		logger.info('[Core] Admin updated service status', {
			adminUserId: user.id,
			providerId,
			serviceType,
			status,
		})

		return c.json(service)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error && error.message === 'Service not found for this provider') {
			return c.json({ error: 'Service not found' }, 404)
		}
		logger.error('[Core] Failed to update service status', { error })
		return c.json({ error: 'Failed to update service status' }, 500)
	}
})

// ==========================================
// Contact Management Routes
// ==========================================

/**
 * Add a contact to a provider
 * POST /industry/providers/:providerId/contacts
 */
app.post('/industry/providers/:providerId/contacts', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Parse and validate request body
		const bodySchema = z.object({
			contactType: z.enum(Object.values(ContactType) as [ContactType, ...ContactType[]]),
		})

		const body = await c.req.json()
		const { contactType } = bodySchema.parse(body)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Add contact via RPC
		const contact = await stub.addContact(providerId, contactType, user.id)

		logger.info('[Core] Admin added contact to provider', {
			adminUserId: user.id,
			providerId,
			contactType,
			contactId: contact.id,
		})

		return c.json(contact, 201)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid request', details: error.issues }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to add contact to provider', { error })
		return c.json({ error: 'Failed to add contact' }, 500)
	}
})

/**
 * List contacts for a provider
 * GET /industry/providers/:providerId/contacts
 */
app.get('/industry/providers/:providerId/contacts', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const providerId = c.req.param('providerId') as ServiceProviderId

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(providerId)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// List contacts via RPC
		const contacts = await stub.listProviderContacts(providerId)

		return c.json(contacts)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid provider ID format' }, 400)
		}
		if (error instanceof Error && error.message === 'Service provider not found') {
			return c.json({ error: 'Provider not found' }, 404)
		}
		logger.error('[Core] Failed to list provider contacts', { error })
		return c.json({ error: 'Failed to list contacts' }, 500)
	}
})

/**
 * Remove a contact
 * DELETE /industry/contacts/:contactId
 */
app.delete('/industry/contacts/:contactId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const contactId = c.req.param('contactId')

		// Validate UUID format
		const uuidSchema = z.uuid()
		uuidSchema.parse(contactId)

		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Remove contact via RPC
		await stub.removeContact(contactId, user.id)

		logger.info('[Core] Admin removed contact', {
			adminUserId: user.id,
			contactId,
		})

		return c.json({ message: 'Contact removed successfully' })
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid contact ID format' }, 400)
		}
		if (error instanceof Error && error.message === 'Contact not found') {
			return c.json({ error: 'Contact not found' }, 404)
		}
		logger.error('[Core] Failed to remove contact', { error })
		return c.json({ error: 'Failed to remove contact' }, 500)
	}
})

// ==========================================
// Statistics Routes
// ==========================================

/**
 * Get provider statistics
 * GET /industry/stats
 */
app.get('/industry/stats', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		// Get Industry DO stub
		const stub = getStub<Industry>(c.env.INDUSTRY, 'default')

		// Get statistics via RPC
		const stats = await stub.getProviderStats()

		return c.json(stats)
	} catch (error) {
		logger.error('[Core] Failed to get industry statistics', { error })
		return c.json({ error: 'Failed to get statistics' }, 500)
	}
})

export default app