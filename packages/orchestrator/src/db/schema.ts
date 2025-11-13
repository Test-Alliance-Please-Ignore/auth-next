import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Database schema for the orchestrator worker
 *
 * Add your table definitions here using Drizzle ORM.
 *
 * Example:
 * export const users = pgTable('users', {
 *   id: uuid('id').defaultRandom().primaryKey(),
 *   email: varchar('email', { length: 255 }).notNull().unique(),
 *   name: varchar('name', { length: 255 }).notNull(),
 *   createdAt: timestamp('created_at').defaultNow().notNull(),
 *   updatedAt: timestamp('updated_at').defaultNow().notNull(),
 * })
 */

export const workflowInstances = pgTable(
	'orchestrator_workflow_instances',
	{
		/** Primary key */
		id: text('id').primaryKey(),
		/** Type of workflow */
		workflowType: text('workflow_type').notNull(),
		/** ID of the resource the workflow is for */
		resourceId: text('resource_id').notNull(),

		/** Whether the workflow has finished */
		finished: boolean('finished').default(false).notNull(),
		/** Whether the workflow has failed */
		failed: boolean('failed').default(false).notNull(),
		/** Status of the workflow */
		status: text('status').notNull(),
		/** Error message if the workflow failed */
		errorMessage: text('error_message'),
		/** Timestamp when the workflow finished */
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		/** Timestamp when the workflow was created */
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		/** Timestamp when the workflow was updated */
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index('orchestrator_workflow_instances_finished_idx').on(table.finished),
		index('orchestrator_workflow_instances_failed_idx').on(table.failed),
		index('orchestrator_workflow_instances_workflow_type_idx').on(table.workflowType),
		index('orchestrator_workflow_instances_resource_id_idx').on(table.resourceId),
		index('orchestrator_workflow_instances_status_idx').on(table.status),
		index('orchestrator_workflow_instances_finished_at_idx').on(table.finishedAt),
		index('orchestrator_workflow_instances_workflow_type_resource_id_idx').on(
			table.workflowType,
			table.resourceId
		),
	]
)

export const schema = {
	workflowInstances,
}

