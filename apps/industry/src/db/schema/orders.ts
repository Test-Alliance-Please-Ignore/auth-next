import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { EntityType, OrderStatus, ServiceType } from '@repo/industry'

export const orders = pgTable(
	'industry_orders',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		title: text('title').notNull(),
		description: text('description'),
		status: text('status', {
			enum: [
				OrderStatus.PENDING,
				OrderStatus.ACCEPTED,
				OrderStatus.IN_PRODUCTION,
				OrderStatus.READY_FOR_DELIVERY,
				OrderStatus.IN_TRANSIT,
				OrderStatus.DELIVERED,
				OrderStatus.COMPLETED,
				OrderStatus.CANCELLED,
				OrderStatus.EXPIRED,
			],
		})
			.default(OrderStatus.PENDING)
			.notNull(),

		orderType: text('order_type', {
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

		issuerEntityId: text('issuer_entity_id').notNull(),
		issuerEntityType: text('issuer_entity_type', {
			enum: [
				EntityType.USER,
				EntityType.CHARACTER,
				EntityType.CORPORATION,
				EntityType.ALLIANCE,
				EntityType.SERVICE_PROVIDER,
			],
		}).notNull(),

		assigneeEntityId: text('assignee_entity_id'),
		assigneeEntityType: text('assignee_entity_type', {
			enum: [
				EntityType.USER,
				EntityType.CHARACTER,
				EntityType.CORPORATION,
				EntityType.ALLIANCE,
				EntityType.SERVICE_PROVIDER,
			],
		}),

		eveContractId: text('eve_contract_id'),
		// Locations (EVE location IDs)
		deliveryLocationId: text('delivery_location_id'),

		// Financial
		rewardAmount: text('reward_amount').notNull(), // ISK
		collateralAmount: text('collateral_amount').default('0'),

		// Dates
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		rejectedAt: timestamp('rejected_at', { withTimezone: true }),
		refundedAt: timestamp('refunded_at', { withTimezone: true }),
	},
	(table) => [
		// Status and type
		index('industry_orders_status_idx').on(table.status),
		index('industry_orders_order_type_idx').on(table.orderType),

		// Issuer lookups
		index('industry_orders_issuer_entity_id_idx').on(table.issuerEntityId),
		index('industry_orders_issuer_entity_type_issuer_entity_id_idx').on(
			table.issuerEntityType,
			table.issuerEntityId
		),

		// Assignee lookups
		index('industry_orders_assignee_entity_id_idx').on(table.assigneeEntityId),
		index('industry_orders_assignee_entity_type_assignee_entity_id_idx').on(
			table.assigneeEntityType,
			table.assigneeEntityId
		),

		// External references
		index('industry_orders_eve_contract_id_idx').on(table.eveContractId),
		index('industry_orders_delivery_location_id_idx').on(table.deliveryLocationId),

		// Common composite queries
		index('industry_orders_status_created_at_idx').on(table.status, table.createdAt),
		index('industry_orders_status_order_type_idx').on(table.status, table.orderType),

		// Timestamps
		index('industry_orders_created_at_idx').on(table.createdAt),
		index('industry_orders_updated_at_idx').on(table.updatedAt),
		index('industry_orders_expires_at_idx').on(table.expiresAt),
		index('industry_orders_accepted_at_idx').on(table.acceptedAt),
		index('industry_orders_completed_at_idx').on(table.completedAt),
		index('industry_orders_cancelled_at_idx').on(table.cancelledAt),
		index('industry_orders_rejected_at_idx').on(table.rejectedAt),
		index('industry_orders_refunded_at_idx').on(table.refundedAt),
	]
)

export const orderStatusHistory = pgTable(
	'industry_order_status_history',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id),
		previousStatus: text('previous_status', {
			enum: [
				OrderStatus.PENDING,
				OrderStatus.ACCEPTED,
				OrderStatus.IN_PRODUCTION,
				OrderStatus.READY_FOR_DELIVERY,
				OrderStatus.IN_TRANSIT,
				OrderStatus.DELIVERED,
				OrderStatus.COMPLETED,
				OrderStatus.CANCELLED,
				OrderStatus.EXPIRED,
			],
		}).notNull(),
		newStatus: text('new_status', {
			enum: [
				OrderStatus.PENDING,
				OrderStatus.ACCEPTED,
				OrderStatus.IN_PRODUCTION,
				OrderStatus.READY_FOR_DELIVERY,
				OrderStatus.IN_TRANSIT,
				OrderStatus.DELIVERED,
				OrderStatus.COMPLETED,
				OrderStatus.CANCELLED,
				OrderStatus.EXPIRED,
			],
		}).notNull(),
		actorEntityId: text('actor_entity_id').notNull(),
		actorEntityType: text('actor_entity_type', {
			enum: [
				EntityType.USER,
				EntityType.CHARACTER,
				EntityType.CORPORATION,
				EntityType.ALLIANCE,
				EntityType.SERVICE_PROVIDER,
			],
		}).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Foreign key lookup
		index('industry_order_status_history_order_id_idx').on(table.orderId),

		// Actor lookups
		index('industry_order_status_history_actor_entity_id_idx').on(table.actorEntityId),
		index('industry_order_status_history_actor_entity_type_actor_entity_id_idx').on(
			table.actorEntityType,
			table.actorEntityId
		),

		// Common composite query: ordered history by order
		index('industry_order_status_history_order_id_created_at_idx').on(
			table.orderId,
			table.createdAt
		),

		// Sorting/pagination
		index('industry_order_status_history_created_at_idx').on(table.createdAt),
	]
)
