import { boolean, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

import { ContactType, EntityType, ServiceStatus, ServiceType } from '@repo/industry'

export const serviceProviders = pgTable(
	'industry_service_providers',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		description: text('description'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		ownerEntityId: text('owner_entity_id').notNull(),
		ownerEntityType: text('owner_entity_type', {
			enum: [
				EntityType.USER,
				EntityType.CHARACTER,
				EntityType.CORPORATION,
				EntityType.ALLIANCE,
				EntityType.SERVICE_PROVIDER,
			],
		}).notNull(),
		acceptingOrders: boolean('accepting_orders').default(false).notNull(),
	},
	(table) => [
		// Timestamps
		index('industry_service_providers_created_at_idx').on(table.createdAt),
		index('industry_service_providers_updated_at_idx').on(table.updatedAt),

		// Owner lookups
		index('industry_service_providers_owner_entity_id_idx').on(table.ownerEntityId),
		index('industry_service_providers_owner_entity_type_owner_entity_id_idx').on(
			table.ownerEntityType,
			table.ownerEntityId
		),

		// Filtering
		index('industry_service_providers_accepting_orders_idx').on(table.acceptingOrders),
	]
)

export const providerServices = pgTable(
	'industry_provider_services',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		providerId: uuid('provider_id')
			.notNull()
			.references(() => serviceProviders.id),
		serviceType: text('service_type', {
			enum: [
				ServiceType.GENERAL_MANUFACTURING,
				ServiceType.CAPITAL_SHIP_MANUFACTURING,
				ServiceType.SUPERCAPITAL_SHIP_MANUFACTURING,
				ServiceType.RESEARCHING,
				ServiceType.BLUEPRINT_COPYING,
				ServiceType.INVENTION,
				ServiceType.REACTION,
				ServiceType.HAULING,
				ServiceType.CUSTOM_HAULING,
				ServiceType.BUYBACK,
				ServiceType.ACQUISITION,
				ServiceType.BOOKMARKS,
				ServiceType.OTHER_SERVICE,
			],
		}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		status: text('status', {
			enum: [ServiceStatus.ACTIVE, ServiceStatus.INACTIVE, ServiceStatus.CLOSED],
		})
			.default(ServiceStatus.INACTIVE)
			.notNull(),
	},
	(table) => [
		// Foreign key lookup
		index('industry_provider_services_provider_id_idx').on(table.providerId),

		// Service metadata
		index('industry_provider_services_service_type_idx').on(table.serviceType),
		index('industry_provider_services_status_idx').on(table.status),

		// Timestamps
		index('industry_provider_services_created_at_idx').on(table.createdAt),
		index('industry_provider_services_updated_at_idx').on(table.updatedAt),

		// Common composite queries
		index('industry_provider_services_provider_id_status_idx').on(table.providerId, table.status),
		index('industry_provider_services_service_type_status_idx').on(table.serviceType, table.status),

		// Unique constraint: one service type per provider
		unique('industry_provider_services_provider_id_service_type_unique').on(
			table.providerId,
			table.serviceType
		),
	]
)

export const providerContacts = pgTable(
	'industry_provider_contacts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		providerId: uuid('provider_id')
			.notNull()
			.references(() => serviceProviders.id),
		contactType: text('contact_type', {
			enum: [
				ContactType.USER,
				ContactType.CHARACTER,
				ContactType.CORPORATION,
				ContactType.MAILING_LIST,
				ContactType.DISCORD_SERVER_AND_CHANNEL,
				ContactType.DISCORD_USER,
			],
		}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Foreign key lookup
		index('industry_provider_contacts_provider_id_idx').on(table.providerId),

		// Contact metadata
		index('industry_provider_contacts_contact_type_idx').on(table.contactType),

		// Common composite query
		index('industry_provider_contacts_provider_id_contact_type_idx').on(
			table.providerId,
			table.contactType
		),

		// Timestamps
		index('industry_provider_contacts_created_at_idx').on(table.createdAt),
		index('industry_provider_contacts_updated_at_idx').on(table.updatedAt),
	]
)
