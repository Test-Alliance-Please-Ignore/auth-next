import { relations } from 'drizzle-orm'
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

/**
 * Enums
 */

/** Broadcast target types */
export const targetTypeEnum = pgEnum('target_type', ['discord_channel'])

/** Broadcast status */
export const broadcastStatusEnum = pgEnum('broadcast_status', [
	'draft',
	'scheduled',
	'sending',
	'sent',
	'failed',
	'rescinded',
])

/** Broadcast SRP mode (for correlation metadata). */
export const broadcastSrpModeEnum = pgEnum('broadcast_srp_mode', [
	'blanket',
	'military',
	'coalition',
	'disabled',
])

/** Delivery status */
export const deliveryStatusEnum = pgEnum('delivery_status', ['pending', 'sent', 'failed'])

/**
 * Broadcast Targets table - Defines where broadcasts can be sent
 *
 * A target represents a destination for broadcasts (e.g., a Discord channel).
 * Each target is associated with a group and can only be used by authorized members.
 */
export const broadcastTargets = pgTable(
	'broadcast_targets',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Target name for display */
		name: varchar('name', { length: 255 }).notNull(),
		/** Target description */
		description: text('description'),
		/** Type of target */
		type: targetTypeEnum('type').notNull(),
		/** Global permission ID required to send to this target */
		sendPermissionId: uuid('send_permission_id').notNull(),
		/** Global permission ID required to manage this target */
		managePermissionId: uuid('manage_permission_id').notNull(),
		/** Sort order for presenting targets in UI (ascending) */
		displayOrder: integer('display_order').notNull().default(0),
		/** Configuration data (JSON) - e.g., { guildId, channelId } for Discord */
		config: jsonb('config').notNull(),
		/** User ID who created this target */
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('broadcast_targets_send_permission_id_idx').on(table.sendPermissionId),
		index('broadcast_targets_manage_permission_id_idx').on(table.managePermissionId),
		index('broadcast_targets_type_idx').on(table.type),
		index('broadcast_targets_display_order_idx').on(table.displayOrder),
	]
)

/**
 * Broadcast Templates table - Reusable message templates
 *
 * Templates define the structure and content of broadcasts with support for
 * dynamic fields that can be filled in when creating a broadcast.
 */
export const broadcastTemplates = pgTable(
	'broadcast_templates',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Template name */
		name: varchar('name', { length: 255 }).notNull(),
		/** Template description */
		description: text('description'),
		/** Target type this template is designed for */
		targetType: varchar('target_type', { length: 100 }).notNull(),
		/** Sort order for presenting templates in UI (ascending) */
		displayOrder: integer('display_order').notNull().default(0),
		/** Field schema (JSON array) - defines what fields need to be filled */
		fieldSchema: jsonb('field_schema').notNull(),
		/** Message template with {{placeholder}} syntax */
		messageTemplate: text('message_template').notNull(),
		/** User ID who created this template */
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('broadcast_templates_target_type_idx').on(table.targetType),
		index('broadcast_templates_display_order_idx').on(table.displayOrder),
	]
)

/**
 * Broadcast Template Targets table - Template to target attachments
 *
 * A template can be attached to multiple targets of the same target type.
 */
export const broadcastTemplateTargets = pgTable(
	'broadcast_template_targets',
	{
		templateId: uuid('template_id')
			.notNull()
			.references(() => broadcastTemplates.id, { onDelete: 'cascade' }),
		targetId: uuid('target_id')
			.notNull()
			.references(() => broadcastTargets.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.templateId, table.targetId] }),
		index('broadcast_template_targets_template_id_idx').on(table.templateId),
		index('broadcast_template_targets_target_id_idx').on(table.targetId),
	]
)

/**
 * Broadcasts table - Individual broadcast instances
 *
 * Represents an actual broadcast message that has been created and
 * can be sent immediately or scheduled for later delivery.
 */
export const broadcasts = pgTable(
	'broadcasts',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Optional template this broadcast was created from */
		templateId: uuid('template_id').references(() => broadcastTemplates.id, {
			onDelete: 'set null',
		}),
		/** Target where this broadcast will be sent */
		targetId: uuid('target_id')
			.notNull()
			.references(() => broadcastTargets.id, { onDelete: 'cascade' }),
		/** Broadcast title */
		title: varchar('title', { length: 255 }).notNull(),
		/** Broadcast content (JSON) - filled template data or custom content */
		content: jsonb('content').notNull(),
		/** Current status */
		status: broadcastStatusEnum('status').notNull().default('draft'),
		/** When to send (null for immediate) */
		scheduledFor: timestamp('scheduled_for'),
		/** When the broadcast was sent */
		sentAt: timestamp('sent_at'),
		/** Error message if failed */
		errorMessage: text('error_message'),
		/** Global permission ID used to authorize this broadcast */
		permissionId: uuid('permission_id').notNull(),
		/** User ID who created this broadcast */
		createdBy: varchar('created_by', { length: 255 }).notNull(),
		/** Main character name of the user who created this broadcast */
		createdByCharacterName: varchar('created_by_character_name', { length: 255 }).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		index('broadcasts_permission_id_idx').on(table.permissionId),
		index('broadcasts_status_idx').on(table.status),
		index('broadcasts_created_by_idx').on(table.createdBy),
		index('broadcasts_scheduled_for_idx').on(table.scheduledFor),
		index('broadcasts_target_id_idx').on(table.targetId),
	]
)

/**
 * Broadcast Session Links table
 *
 * Stores linkage between a broadcast and its generated SRP token / optional
 * fleet tracking session. This keeps correlation metadata queryable without
 * depending on JSON content fields.
 */
export const broadcastSessionLinks = pgTable(
	'broadcast_session_links',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		broadcastId: uuid('broadcast_id')
			.notNull()
			.references(() => broadcasts.id, { onDelete: 'cascade' }),
		srpMode: broadcastSrpModeEnum('srp_mode'),
		srpToken: varchar('srp_token', { length: 255 }),
		doctrineId: uuid('doctrine_id'),
		fleetSessionId: uuid('fleet_session_id'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex('broadcast_session_links_broadcast_id_unique').on(table.broadcastId),
		uniqueIndex('broadcast_session_links_srp_token_unique').on(table.srpToken),
		index('broadcast_session_links_doctrine_id_idx').on(table.doctrineId),
		index('broadcast_session_links_fleet_session_id_idx').on(table.fleetSessionId),
	]
)

/**
 * Broadcast Deliveries table - Tracking delivery status per target
 *
 * Tracks the delivery status of each broadcast to each target, including
 * Discord message IDs and error messages for failed deliveries.
 */
export const broadcastDeliveries = pgTable(
	'broadcast_deliveries',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		/** Broadcast this delivery is for */
		broadcastId: uuid('broadcast_id')
			.notNull()
			.references(() => broadcasts.id, { onDelete: 'cascade' }),
		/** Target this delivery was sent to */
		targetId: uuid('target_id')
			.notNull()
			.references(() => broadcastTargets.id, { onDelete: 'cascade' }),
		/** Delivery status */
		status: deliveryStatusEnum('status').notNull().default('pending'),
		/** Discord message ID (if sent successfully) */
		discordMessageId: varchar('discord_message_id', { length: 255 }),
		/** Error message if delivery failed */
		errorMessage: text('error_message'),
		/** When the message was sent */
		sentAt: timestamp('sent_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
	},
	(table) => [
		index('broadcast_deliveries_broadcast_id_idx').on(table.broadcastId),
		index('broadcast_deliveries_status_idx').on(table.status),
	]
)

/**
 * Relations
 */

export const broadcastTemplatesRelations = relations(broadcastTemplates, ({ many }) => ({
	broadcasts: many(broadcasts),
	targetAttachments: many(broadcastTemplateTargets),
}))

export const broadcastTargetsRelations = relations(broadcastTargets, ({ many }) => ({
	broadcasts: many(broadcasts),
	deliveries: many(broadcastDeliveries),
	templateAttachments: many(broadcastTemplateTargets),
}))

export const broadcastTemplateTargetsRelations = relations(broadcastTemplateTargets, ({ one }) => ({
	template: one(broadcastTemplates, {
		fields: [broadcastTemplateTargets.templateId],
		references: [broadcastTemplates.id],
	}),
	target: one(broadcastTargets, {
		fields: [broadcastTemplateTargets.targetId],
		references: [broadcastTargets.id],
	}),
}))

export const broadcastsRelations = relations(broadcasts, ({ one, many }) => ({
	template: one(broadcastTemplates, {
		fields: [broadcasts.templateId],
		references: [broadcastTemplates.id],
	}),
	target: one(broadcastTargets, {
		fields: [broadcasts.targetId],
		references: [broadcastTargets.id],
	}),
	deliveries: many(broadcastDeliveries),
	sessionLinks: many(broadcastSessionLinks),
}))

export const broadcastDeliveriesRelations = relations(broadcastDeliveries, ({ one }) => ({
	broadcast: one(broadcasts, {
		fields: [broadcastDeliveries.broadcastId],
		references: [broadcasts.id],
	}),
	target: one(broadcastTargets, {
		fields: [broadcastDeliveries.targetId],
		references: [broadcastTargets.id],
	}),
}))

export const broadcastSessionLinksRelations = relations(broadcastSessionLinks, ({ one }) => ({
	broadcast: one(broadcasts, {
		fields: [broadcastSessionLinks.broadcastId],
		references: [broadcasts.id],
	}),
}))

/**
 * Schema export for use with createDb
 */
export const schema = {
	broadcastTargets,
	broadcastTemplates,
	broadcastTemplateTargets,
	broadcasts,
	broadcastSessionLinks,
	broadcastDeliveries,
	broadcastTemplatesRelations,
	broadcastTargetsRelations,
	broadcastTemplateTargetsRelations,
	broadcastsRelations,
	broadcastSessionLinksRelations,
	broadcastDeliveriesRelations,
}
