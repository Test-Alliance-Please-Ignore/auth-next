import { and, desc, eq } from '@repo/db-utils'
import {
	ContactType,
	CreateProviderParams,
	EntityType,
	ProviderContact,
	ProviderFilters,
	ProviderServiceDTO,
	ServiceProvider,
	ServiceProviderId,
	ServiceStatus,
	ServiceType,
	UpdateProviderParams,
} from '@repo/industry'

import { providerContacts, providerServices, serviceProviders } from '../db/schema'

import type { ServiceContext } from './context'

/**
 * Provider Service
 *
 * Manages service providers, their services, and contacts.
 */
export class ProviderService {
	constructor(private ctx: ServiceContext) {}

	/**
	 * Create a new service provider
	 */
	async createProvider(params: CreateProviderParams): Promise<ServiceProvider> {
		const [provider] = await this.ctx.db
			.insert(serviceProviders)
			.values({
				name: params.name,
				description: params.description ?? null,
				ownerEntityId: params.ownerEntityId,
				ownerEntityType: params.ownerEntityType,
				acceptingOrders: params.acceptingOrders ?? false,
			})
			.returning()

		if (!provider) {
			throw new Error('Failed to create service provider')
		}

		return this.mapToProvider(provider)
	}

	/**
	 * Get a single provider by ID
	 */
	async getProvider(providerId: ServiceProviderId): Promise<ServiceProvider> {
		const provider = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!provider) {
			throw new Error('Service provider not found')
		}

		return this.mapToProvider(provider)
	}

	/**
	 * List providers with optional filters
	 */
	async listProviders(filters: ProviderFilters = {}): Promise<ServiceProvider[]> {
		const conditions: ReturnType<typeof and>[] = []

		// Apply filters
		if (filters.ownerEntityId) {
			conditions.push(eq(serviceProviders.ownerEntityId, filters.ownerEntityId))
		}

		if (filters.ownerEntityType) {
			conditions.push(eq(serviceProviders.ownerEntityType, filters.ownerEntityType))
		}

		if (filters.acceptingOrders !== undefined) {
			conditions.push(eq(serviceProviders.acceptingOrders, filters.acceptingOrders))
		}

		// Build query
		const query = this.ctx.db.query.serviceProviders.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(serviceProviders.createdAt)],
			limit: filters.limit || 50,
			offset: filters.offset || 0,
		})

		const results = await query

		return results.map((provider) => this.mapToProvider(provider))
	}

	/**
	 * Update provider details
	 */
	async updateProvider(
		providerId: ServiceProviderId,
		params: UpdateProviderParams
	): Promise<ServiceProvider> {
		// Check if provider exists
		const existing = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!existing) {
			throw new Error('Service provider not found')
		}

		// Build update object
		const updates: Partial<typeof serviceProviders.$inferInsert> = {
			updatedAt: new Date(),
		}

		if (params.name !== undefined) {
			updates.name = params.name
		}

		if (params.description !== undefined) {
			updates.description = params.description
		}

		if (params.acceptingOrders !== undefined) {
			updates.acceptingOrders = params.acceptingOrders
		}

		// Update the provider
		const [updated] = await this.ctx.db
			.update(serviceProviders)
			.set(updates)
			.where(eq(serviceProviders.id, providerId))
			.returning()

		if (!updated) {
			throw new Error('Failed to update service provider')
		}

		return this.mapToProvider(updated)
	}

	/**
	 * Delete a provider (cascades to services and contacts via foreign keys)
	 */
	async deleteProvider(providerId: ServiceProviderId): Promise<void> {
		// Check if provider exists
		const existing = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!existing) {
			throw new Error('Service provider not found')
		}

		// Delete the provider (cascade will handle related records)
		await this.ctx.db.delete(serviceProviders).where(eq(serviceProviders.id, providerId))
	}

	/**
	 * Set accepting orders status
	 */
	async setAcceptingOrders(
		providerId: ServiceProviderId,
		acceptingOrders: boolean
	): Promise<ServiceProvider> {
		return this.updateProvider(providerId, { acceptingOrders })
	}

	/**
	 * Add a service type to a provider
	 */
	async addService(
		providerId: ServiceProviderId,
		serviceType: ServiceType
	): Promise<ProviderServiceDTO> {
		// Check if provider exists
		const provider = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!provider) {
			throw new Error('Service provider not found')
		}

		// Check if service already exists (unique constraint will also catch this)
		const existing = await this.ctx.db.query.providerServices.findFirst({
			where: and(
				eq(providerServices.providerId, providerId),
				eq(providerServices.serviceType, serviceType)
			),
		})

		if (existing) {
			throw new Error('Service type already exists for this provider')
		}

		// Create the service
		const [service] = await this.ctx.db
			.insert(providerServices)
			.values({
				providerId,
				serviceType,
				status: ServiceStatus.INACTIVE,
			})
			.returning()

		if (!service) {
			throw new Error('Failed to add service to provider')
		}

		return this.mapToProviderService(service)
	}

	/**
	 * Remove a service type from a provider
	 */
	async removeService(providerId: ServiceProviderId, serviceType: ServiceType): Promise<void> {
		// Check if service exists
		const existing = await this.ctx.db.query.providerServices.findFirst({
			where: and(
				eq(providerServices.providerId, providerId),
				eq(providerServices.serviceType, serviceType)
			),
		})

		if (!existing) {
			throw new Error('Service not found for this provider')
		}

		// Delete the service
		await this.ctx.db
			.delete(providerServices)
			.where(
				and(
					eq(providerServices.providerId, providerId),
					eq(providerServices.serviceType, serviceType)
				)
			)
	}

	/**
	 * Update service status
	 */
	async updateServiceStatus(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		status: ServiceStatus
	): Promise<ProviderServiceDTO> {
		// Check if service exists
		const existing = await this.ctx.db.query.providerServices.findFirst({
			where: and(
				eq(providerServices.providerId, providerId),
				eq(providerServices.serviceType, serviceType)
			),
		})

		if (!existing) {
			throw new Error('Service not found for this provider')
		}

		// Update the service
		const [updated] = await this.ctx.db
			.update(providerServices)
			.set({
				status,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(providerServices.providerId, providerId),
					eq(providerServices.serviceType, serviceType)
				)
			)
			.returning()

		if (!updated) {
			throw new Error('Failed to update service status')
		}

		return this.mapToProviderService(updated)
	}

	/**
	 * List all services for a provider
	 */
	async listProviderServices(providerId: ServiceProviderId): Promise<ProviderServiceDTO[]> {
		// Check if provider exists
		const provider = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!provider) {
			throw new Error('Service provider not found')
		}

		// Get all services
		const services = await this.ctx.db.query.providerServices.findMany({
			where: eq(providerServices.providerId, providerId),
			orderBy: [desc(providerServices.createdAt)],
		})

		return services.map((service) => this.mapToProviderService(service))
	}

	/**
	 * Add a contact to a provider
	 */
	async addContact(
		providerId: ServiceProviderId,
		contactType: ContactType
	): Promise<ProviderContact> {
		// Check if provider exists
		const provider = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!provider) {
			throw new Error('Service provider not found')
		}

		// Create the contact
		const [contact] = await this.ctx.db
			.insert(providerContacts)
			.values({
				providerId,
				contactType,
			})
			.returning()

		if (!contact) {
			throw new Error('Failed to add contact to provider')
		}

		return this.mapToProviderContact(contact)
	}

	/**
	 * Remove a contact from a provider
	 */
	async removeContact(contactId: string): Promise<void> {
		// Check if contact exists
		const existing = await this.ctx.db.query.providerContacts.findFirst({
			where: eq(providerContacts.id, contactId),
		})

		if (!existing) {
			throw new Error('Contact not found')
		}

		// Delete the contact
		await this.ctx.db.delete(providerContacts).where(eq(providerContacts.id, contactId))
	}

	/**
	 * List all contacts for a provider
	 */
	async listProviderContacts(providerId: ServiceProviderId): Promise<ProviderContact[]> {
		// Check if provider exists
		const provider = await this.ctx.db.query.serviceProviders.findFirst({
			where: eq(serviceProviders.id, providerId),
		})

		if (!provider) {
			throw new Error('Service provider not found')
		}

		// Get all contacts
		const contacts = await this.ctx.db.query.providerContacts.findMany({
			where: eq(providerContacts.providerId, providerId),
			orderBy: [desc(providerContacts.createdAt)],
		})

		return contacts.map((contact) => this.mapToProviderContact(contact))
	}

	/**
	 * Map database record to ServiceProvider DTO
	 */
	private mapToProvider(provider: typeof serviceProviders.$inferSelect): ServiceProvider {
		return {
			id: provider.id as ServiceProviderId,
			name: provider.name,
			description: provider.description,
			createdAt: provider.createdAt,
			updatedAt: provider.updatedAt,
			ownerEntityId: provider.ownerEntityId,
			ownerEntityType: provider.ownerEntityType as EntityType,
			acceptingOrders: provider.acceptingOrders,
		}
	}

	/**
	 * Map database record to ProviderService DTO
	 */
	private mapToProviderService(service: typeof providerServices.$inferSelect): ProviderServiceDTO {
		return {
			id: service.id,
			providerId: service.providerId as ServiceProviderId,
			serviceType: service.serviceType as ServiceType,
			status: service.status as ServiceStatus,
			createdAt: service.createdAt,
			updatedAt: service.updatedAt,
		}
	}

	/**
	 * Map database record to ProviderContact DTO
	 */
	private mapToProviderContact(contact: typeof providerContacts.$inferSelect): ProviderContact {
		return {
			id: contact.id,
			providerId: contact.providerId as ServiceProviderId,
			contactType: contact.contactType as ContactType,
			createdAt: contact.createdAt,
			updatedAt: contact.updatedAt,
		}
	}
}
