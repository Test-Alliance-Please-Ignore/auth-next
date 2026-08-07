import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { EntityType, TransactionType } from '@repo/industry'

import { orders } from './orders'

export const transactions = pgTable(
	'industry_transactions',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		orderId: uuid('order_id')
			.notNull()
			.references(() => orders.id),

		fromEntityId: text('from_entity_id').notNull(),
		fromEntityType: text('from_entity_type', {
			enum: [
				EntityType.USER,
				EntityType.CHARACTER,
				EntityType.CORPORATION,
				EntityType.ALLIANCE,
				EntityType.SERVICE_PROVIDER,
			],
		}).notNull(),
		toEntityId: text('to_entity_id').notNull(),
		toEntityType: text('to_entity_type', {
			enum: [
				EntityType.USER,
				EntityType.CHARACTER,
				EntityType.CORPORATION,
				EntityType.ALLIANCE,
				EntityType.SERVICE_PROVIDER,
			],
		}).notNull(),
		amount: text('amount').notNull(), // ISK
		type: text('type', {
			enum: [
				TransactionType.ORDER_PAYMENT,
				TransactionType.ORDER_REFUND,
				TransactionType.ORDER_COLLATERAL,
				TransactionType.ORDER_REWARD,
				TransactionType.ORDER_CANCELLATION,
				TransactionType.ORDER_EXPIRATION,
				TransactionType.ORDER_REJECTION,
				TransactionType.SERVICE_PROVIDER_PAYMENT,
				TransactionType.SERVICE_PROVIDER_REFUND,
				TransactionType.SERVICE_PROVIDER_COLLATERAL,
				TransactionType.SERVICE_PROVIDER_REWARD,
				TransactionType.SERVICE_PROVIDER_CANCELLATION,
				TransactionType.SERVICE_PROVIDER_EXPIRATION,
				TransactionType.SERVICE_PROVIDER_REJECTION,
			],
		}).notNull(),
		status: text('status', {
			enum: ['pending', 'completed', 'cancelled', 'refunded', 'escrowed', 'released'],
		})
			.default('pending')
			.notNull(),
		notes: text('notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		// Foreign key lookup
		index('industry_transactions_order_id_idx').on(table.orderId),

		// Entity lookups - from
		index('industry_transactions_from_entity_id_idx').on(table.fromEntityId),
		index('industry_transactions_from_entity_type_from_entity_id_idx').on(
			table.fromEntityType,
			table.fromEntityId
		),

		// Entity lookups - to
		index('industry_transactions_to_entity_id_idx').on(table.toEntityId),
		index('industry_transactions_to_entity_type_idx').on(table.toEntityType),
		index('industry_transactions_to_entity_type_to_entity_id_idx').on(
			table.toEntityType,
			table.toEntityId
		),

		// Transaction metadata
		index('industry_transactions_transaction_type_idx').on(table.type),
		index('industry_transactions_transaction_status_idx').on(table.status),

		// Common composite queries
		index('industry_transactions_status_created_at_idx').on(table.status, table.createdAt),
		index('industry_transactions_order_id_status_idx').on(table.orderId, table.status),

		// Sorting/pagination
		index('industry_transactions_created_at_idx').on(table.createdAt),
		index('industry_transactions_updated_at_idx').on(table.updatedAt),
	]
)
