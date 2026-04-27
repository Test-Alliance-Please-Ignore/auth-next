/**
 * Queue consumer for character report requests
 * Handles asynchronous report creation via CHARACTER_REPORTS_QUEUE
 */

import { logger } from '@repo/hono-helpers'
import { DEFAULT_RETENTION_DAYS, RETENTION_POLICIES } from '@repo/fulcrum'
import { createDb } from './db'
import * as queries from './db/queries'
import { sendReportFailedDM } from './lib/discord-webhook'
import { resolveReportMetadata } from './lib/report-metadata'
import type { Env } from './context'
import type { WorkflowParams } from './workflows/character-report.workflow.js'

/**
 * Message body for CHARACTER_REPORTS_QUEUE
 */
export interface CharacterReportQueueMessage {
	reportId: string
	characterId: string
	requestorUserId: string
	requestorCorporationId: string
	requestSource: string
	applicationId?: string
	expiresAt?: string // ISO date string
	sendDm?: boolean
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
			const {
				reportId,
				characterId,
				requestorUserId,
				requestorCorporationId,
				requestSource,
				applicationId,
				expiresAt,
				sendDm = true,
			} =
				message.body

			queueLogger.info('Processing report request', {
				reportId,
				characterId,
				requestorCorporationId,
			})

			// Compute retention from server-side policy
			const retentionDays = RETENTION_POLICIES[requestSource as keyof typeof RETENTION_POLICIES] ?? DEFAULT_RETENTION_DAYS

			// Create database record
			await queries.createCharacterReport(db, {
				id: reportId,
				characterId,
				requestorUserId,
				requestorCorporationId,
				requestSource,
				applicationId,
				retentionDays,
				expiresAt: expiresAt ? new Date(expiresAt) : undefined,
			})

			// Start workflow
			const workflowParams: WorkflowParams = {
				reportId,
				characterId,
				sendDm,
			}

			const workflowInstance = await env.CHARACTER_REPORT_WORKFLOW.create({
				id: `${characterId}-${reportId}-${Date.now()}`,
				params: workflowParams,
			})
			await queries.updateReportStatus(db, reportId, 'pending', {
				workflowInstanceId: workflowInstance.id,
			})

			queueLogger.info('Workflow started', {
				reportId,
				characterId,
			})

			// Acknowledge successful processing
			message.ack()
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			queueLogger.error('Failed to process message', {
				error: errorMessage,
				errorStack: error instanceof Error ? error.stack : undefined,
				messageId: message.id,
				body: message.body,
			})

			// Update database to mark report as failed
			const { reportId, characterId, requestorUserId, requestorCorporationId } =
				message.body

			try {
				await queries.updateReportStatus(db, reportId, 'failed', {
					errorMessage,
				})

				// Send Discord DM notification (non-blocking)
				if (message.body.sendDm ?? true) {
					try {
						const report = await queries.getReport(db, reportId)

						if (report) {
							const metadata = await resolveReportMetadata(
								env,
								reportId,
								requestorUserId,
								characterId,
								report.characterName,
								requestorCorporationId
							)

							if (metadata) {
								await sendReportFailedDM(env, requestorUserId, metadata, errorMessage)
							}
						}
					} catch (dmError) {
						queueLogger.error('Failed to send report failed DM', {
							reportId,
							error:
								dmError instanceof Error ? dmError.message : String(dmError),
						})
					}
				}
			} catch (updateError) {
				queueLogger.error('Failed to update report status to failed', {
					reportId,
					error: updateError instanceof Error ? updateError.message : String(updateError),
				})
			}

			// Retry the message
			message.retry()
		}
	}
}
