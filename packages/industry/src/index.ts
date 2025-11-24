/**
 * @repo/industry
 *
 * Shared types and interfaces for the Industry Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

/**
 * A generic branded type that adds a readonly brand property to any type T.
 * This pattern helps prevent accidental mixing of different ID types by making
 * them structurally different at the type level while maintaining the same runtime value.
 *
 * @template T - The underlying type to brand
 * @template Brand - The string literal type used as the brand identifier
 */
type BrandedType<T, Brand extends string> = T & { readonly __brand: Brand }

/**
 * Branded type for Service Provider IDs.
 * These are UUIDs representing unique service provider identifiers.
 *
 * @example
 * ```typescript
 * const providerId: ServiceProviderId = '550e8400-e29b-41d4-a716-446655440000' as ServiceProviderId;
 * ```
 */
export type ServiceProviderId = BrandedType<string, 'ServiceProviderId'>

/**
 * Public RPC interface for Industry Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Industry } from '@repo/industry'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Industry>(env.INDUSTRY, 'my-id')
 * // Call RPC methods on stub
 * ```
 */
export interface Industry extends DurableObject {
	// Provider management
	createProvider(params: CreateProviderParams, adminUserId: string): Promise<ServiceProvider>
	getProvider(providerId: ServiceProviderId): Promise<ServiceProvider>
	listProviders(filters: ProviderFilters): Promise<ServiceProvider[]>
	updateProvider(
		providerId: ServiceProviderId,
		params: UpdateProviderParams,
		adminUserId: string
	): Promise<ServiceProvider>
	deleteProvider(providerId: ServiceProviderId, adminUserId: string): Promise<void>
	setAcceptingOrders(
		providerId: ServiceProviderId,
		acceptingOrders: boolean,
		adminUserId: string
	): Promise<ServiceProvider>

	// Service management
	addService(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		adminUserId: string
	): Promise<ProviderServiceDTO>
	removeService(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		adminUserId: string
	): Promise<void>
	updateServiceStatus(
		providerId: ServiceProviderId,
		serviceType: ServiceType,
		status: ServiceStatus,
		adminUserId: string
	): Promise<ProviderServiceDTO>
	listProviderServices(providerId: ServiceProviderId): Promise<ProviderServiceDTO[]>

	// Contact management
	addContact(
		providerId: ServiceProviderId,
		contactType: ContactType,
		adminUserId: string
	): Promise<ProviderContact>
	removeContact(contactId: string, adminUserId: string): Promise<void>
	listProviderContacts(providerId: ServiceProviderId): Promise<ProviderContact[]>

	// Statistics
	getProviderStats(): Promise<ProviderStatistics>
}

export enum EntityType {
	USER = 'user',
	CHARACTER = 'character',
	CORPORATION = 'corporation',
	ALLIANCE = 'alliance',
	SERVICE_PROVIDER = 'service_provider',
}

export enum TransactionStatus {
	PENDING = 'pending',
	COMPLETED = 'completed',
	CANCELLED = 'cancelled',
	REFUNDED = 'refunded',
	ESCROWED = 'escrowed',
	RELEASED = 'released',
}

export enum OrderStatus {
	PENDING = 'pending',
	ACCEPTED = 'accepted',
	IN_PRODUCTION = 'in_production',
	READY_FOR_DELIVERY = 'ready_for_delivery',
	IN_TRANSIT = 'in_transit',
	DELIVERED = 'delivered',
	COMPLETED = 'completed',
	CANCELLED = 'cancelled',
	EXPIRED = 'expired',
}

export enum TransactionType {
	ORDER_PAYMENT = 'order_payment',
	ORDER_REFUND = 'order_refund',
	ORDER_COLLATERAL = 'order_collateral',
	ORDER_REWARD = 'order_reward',
	ORDER_CANCELLATION = 'order_cancellation',
	ORDER_EXPIRATION = 'order_expiration',
	ORDER_REJECTION = 'order_rejection',
	SERVICE_PROVIDER_PAYMENT = 'service_provider_payment',
	SERVICE_PROVIDER_REFUND = 'service_provider_refund',
	SERVICE_PROVIDER_COLLATERAL = 'service_provider_collateral',
	SERVICE_PROVIDER_REWARD = 'service_provider_reward',
	SERVICE_PROVIDER_CANCELLATION = 'service_provider_cancellation',
	SERVICE_PROVIDER_EXPIRATION = 'service_provider_expiration',
	SERVICE_PROVIDER_REJECTION = 'service_provider_rejection',
}

export enum ServiceType {
	GENERAL_MANUFACTURING = 'general_manufacturing',
	CAPITAL_SHIP_MANUFACTURING = 'capital_ship_manufacturing',
	SUPERCAPITAL_SHIP_MANUFACTURING = 'supercapital_ship_manufacturing',
	RESEARCHING = 'research',
	BLUEPRINT_COPYING = 'blueprint_copying',
	INVENTION = 'invention',
	REACTION = 'reaction',
	HAULING = 'hauling',
	CUSTOM_HAULING = 'custom_hauling',
	BUYBACK = 'buyback',
	ACQUISITION = 'acquisition',
	BOOKMARKS = 'bookmarks',
	OTHER_SERVICE = 'other_service',
}

export enum ServiceStatus {
	ACTIVE = 'active',
	INACTIVE = 'inactive',
	CLOSED = 'closed',
}

export enum ContactType {
	USER = 'user',
	CHARACTER = 'character',
	CORPORATION = 'corporation',
	MAILING_LIST = 'mailing_list',
	DISCORD_SERVER_AND_CHANNEL = 'discord_server_and_channel',
	DISCORD_USER = 'discord_user',
}

/**
 * Service Provider DTO
 */
export interface ServiceProvider {
	id: ServiceProviderId
	name: string
	description: string | null
	createdAt: Date
	updatedAt: Date
	ownerEntityId: string
	ownerEntityType: EntityType
	acceptingOrders: boolean
}

/**
 * Provider Service DTO
 */
export interface ProviderServiceDTO {
	id: string
	providerId: ServiceProviderId
	serviceType: ServiceType
	status: ServiceStatus
	createdAt: Date
	updatedAt: Date
}

/**
 * Provider Contact DTO
 */
export interface ProviderContact {
	id: string
	providerId: ServiceProviderId
	contactType: ContactType
	createdAt: Date
	updatedAt: Date
}

/**
 * Provider Filters for listing
 */
export interface ProviderFilters {
	ownerEntityId?: string
	ownerEntityType?: EntityType
	acceptingOrders?: boolean
	limit?: number
	offset?: number
}

/**
 * Create Provider Parameters
 */
export interface CreateProviderParams {
	name: string
	description?: string | null
	ownerEntityId: string
	ownerEntityType: EntityType
	acceptingOrders?: boolean
}

/**
 * Update Provider Parameters
 */
export interface UpdateProviderParams {
	name?: string
	description?: string | null
	acceptingOrders?: boolean
}

/**
 * Provider Statistics
 */
export interface ProviderStatistics {
	totalProviders: number
	totalByEntityType: Record<EntityType, number>
	totalAcceptingOrders: number
	totalServices: number
	servicesByType: Record<ServiceType, number>
	servicesByStatus: Record<ServiceStatus, number>
}
