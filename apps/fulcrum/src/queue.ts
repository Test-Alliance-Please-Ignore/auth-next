/**
 * Queue consumer for character report requests
 * Handles asynchronous report creation via CHARACTER_REPORTS_QUEUE
 */

import { logger } from '@repo/hono-helpers'
import { createDb } from './db'
import * as queries from './db/queries'
import type { Env } from './context'
import type { WorkflowParams } from './workflows/character-report.workflow'

/**
 * Message body for CHARACTER_REPORTS_QUEUE
 */
export interface CharacterReportQueueMessage {
	reportId: string
	characterId: string
	requestorUserId: string
	requestorCorporationId: string
	expiresAt?: string // ISO date string
}

/**
 * Handle CHARACTER_REPORTS_QUEUE messages
 * Creates database record and starts workflow
 */
export async function handleCharacterReportsQueue(
	batch: MessageBatch<CharacterReportQueueMessage>,
	env: Env,
	_ctx: ExecutionContext,
): Promise<void> {
	const db = createDb(env.DATABASE_URL)
	const queueLogger = logger.withTags({ queue: 'CHARACTER_REPORTS_QUEUE' })

	for (const message of batch.messages) {
		try {
			const { reportId, characterId, requestorUserId, requestorCorporationId, expiresAt } =
				message.body

			queueLogger.info('Processing report request', {
				reportId,
				characterId,
				requestorCorporationId,
			})

			// Create database record
			await queries.createCharacterReport(db, {
				id: reportId,
				characterId,
				requestorUserId,
				requestorCorporationId,
				expiresAt: expiresAt ? new Date(expiresAt) : undefined,
			})

			// Start workflow
			const workflowParams: WorkflowParams = {
				reportId,
				characterId,
			}

			await env.CHARACTER_REPORT_WORKFLOW.create({
				id: `${characterId}-${reportId}-${Date.now()}`,
				params: workflowParams,
			})

			queueLogger.info('Workflow started', {
				reportId,
				characterId,
			})

			// Acknowledge successful processing
			message.ack()
		} catch (error) {
			queueLogger.error('Failed to process message', {
				error: error instanceof Error ? error.message : String(error),
				errorStack: error instanceof Error ? error.stack : undefined,
				messageId: message.id,
				body: message.body,
			})

			// Retry the message
			message.retry()
		}
	}
}
