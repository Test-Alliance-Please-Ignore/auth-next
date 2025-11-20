import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'
import type { CharacterReportMetadata, Fulcrum, ListReportsFilters } from '@repo/fulcrum'
import { createDb } from './db'
import type { DbClient } from './db/queries'
import * as queries from './db/queries'
import { sendReportStartedWebhook } from './lib/discord-webhook'
import { resolveReportMetadata } from './lib/report-metadata'
import type { Env } from './context'
import type { WorkflowParams } from './workflows/character-report.workflow'

/**
 * Fulcrum Durable Object
 *
 * This Durable Object uses SQLite storage and implements:
 * - RPC methods for remote calls
 * - WebSocket hibernation API
 * - Alarm handler for scheduled tasks
 * - SQLite storage via sql.exec()
 */
export class FulcrumDO extends DurableObject<Env, {}> implements Fulcrum {
	private logger = logger.withTags({ component: 'fulcrum-do' })

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env,
	) {
		super(state, env)
	}

	/**
	 * Get database client
	 * Helper method to create database connection
	 */
	private getDb(): DbClient {
		return createDb(this.env.DATABASE_URL)
	}

	/**
	 * RPC: Create a new character report
	 * Creates database record, queues workflow, returns report ID
	 */
	async createCharacterReport(
		characterId: string,
		requestorUserId: string,
		requestorCorporationId: string,
	): Promise<string> {
		const db = this.getDb()

		// Generate unique report ID
		const reportId = crypto.randomUUID()

		// Set expiration to 7 days from now
		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + 7)

		// Create database record
		await queries.createCharacterReport(db, {
			id: reportId,
			characterId,
			requestorUserId,
			requestorCorporationId,
			expiresAt,
		})

		// Send Discord webhook notification (non-blocking)
		if (this.env.DISCORD_WEBHOOK_URL) {
			try {
				const metadata = await resolveReportMetadata(
					this.env,
					reportId,
					requestorUserId,
					characterId,
					null, // Character name not yet populated
					requestorCorporationId
				)

				if (metadata) {
					await sendReportStartedWebhook(this.env.DISCORD_WEBHOOK_URL, metadata)
				}
			} catch (error) {
				// Log but don't fail - webhook failures should not block report creation
				logger.error('[Fulcrum DO] Failed to send report started webhook', {
					reportId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Start workflow
		const workflowParams: WorkflowParams = {
			reportId,
			characterId,
		}
		await this.env.CHARACTER_REPORT_WORKFLOW.create({
			id: `${characterId}-${reportId}-${Date.now()}`,
			params: workflowParams,
		})

		return reportId
	}

	/**
	 * RPC: Get character report status and metadata
	 * Returns report metadata or null if not found
	 */
	async getReportStatus(reportId: string): Promise<CharacterReportMetadata | null> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		if (!report) {
			return null
		}

		return {
			id: report.id,
			characterId: report.characterId,
			characterName: report.characterName ?? undefined,
			status: report.status,
			requestorUserId: report.requestorUserId,
			requestorCorporationId: report.requestorCorporationId,
			workflowInstanceId: report.workflowInstanceId ?? undefined,
			createdAt: report.createdAt.toISOString(),
			updatedAt: report.updatedAt.toISOString(),
			expiresAt: report.expiresAt?.toISOString(),
			viewedAt: report.viewedAt?.toISOString(),
			errorMessage: report.errorMessage ?? undefined,
		}
	}

	/**
	 * RPC: Get character report HTML content
	 * Updates viewed_at timestamp on first view
	 * Returns HTML or null if not found/expired
	 */
	async getReportHtml(reportId: string): Promise<string | null> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		// Check if report exists and is completed
		if (!report || report.status !== 'completed') {
			return null
		}

		// Check if expired
		if (report.expiresAt && new Date() > report.expiresAt) {
			return null
		}

		// Check if R2 location is available
		if (!report.r2Bucket || !report.r2Key) {
			return null
		}

		// Fetch HTML from R2
		const r2Object = await this.env.CHARACTER_REPORTS.get(report.r2Key)
		if (!r2Object) {
			return null
		}

		const html = await r2Object.text()

		// Mark as viewed (only updates if first view)
		await queries.markReportViewed(db, reportId)

		return html
	}

	/**
	 * RPC: List character reports with optional filters
	 * Returns array of report metadata
	 */
	async listReports(
		filters?: ListReportsFilters,
		limit = 50,
		offset = 0,
	): Promise<CharacterReportMetadata[]> {
		const db = this.getDb()
		const reports = await queries.listReports(db, filters, limit, offset)

		return reports.map((report) => ({
			id: report.id,
			characterId: report.characterId,
			characterName: report.characterName ?? undefined,
			status: report.status,
			requestorUserId: report.requestorUserId,
			requestorCorporationId: report.requestorCorporationId,
			workflowInstanceId: report.workflowInstanceId ?? undefined,
			createdAt: report.createdAt.toISOString(),
			updatedAt: report.updatedAt.toISOString(),
			expiresAt: report.expiresAt?.toISOString(),
			viewedAt: report.viewedAt?.toISOString(),
			errorMessage: report.errorMessage ?? undefined,
		}))
	}

	/**
	 * RPC: Generate a signed URL for sharing a character report
	 * Currently not implemented - returns null
	 * TODO: Implement signed URL generation with R2 presigned URLs or custom tokens
	 */
	async generateShareUrl(reportId: string, expiresIn: number): Promise<string | null> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		// Check if report exists and is completed
		if (!report || report.status !== 'completed') {
			return null
		}

		// TODO: Implement signed URL generation
		// Options:
		// 1. R2 presigned URLs (if available)
		// 2. Custom token-based URLs with verification in CORE worker
		// 3. Time-limited tokens stored in Durable Object state

		return null
	}

	/**
	 * RPC: Cancel a pending or processing character report
	 * Returns true if cancelled, false if not found or already completed
	 */
	async cancelReport(reportId: string): Promise<boolean> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		// Check if report exists
		if (!report) {
			return false
		}

		// Can only cancel pending or processing reports
		if (report.status !== 'pending' && report.status !== 'processing') {
			return false
		}

		// Update status to cancelled
		await queries.updateReportStatus(db, reportId, 'cancelled')

		return true
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
		// TODO: Implement WebSocket message handling
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		wasClean: boolean,
	): Promise<void> {
		// TODO: Implement cleanup logic
	}

	/**
	 * WebSocket error handler (Hibernation API)
	 * Called when a WebSocket error occurs
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		this.logger.error('WebSocket error', {
			error: error instanceof Error ? error.message : String(error),
		})
	}

	/**
	 * Alarm handler
	 * Called when a scheduled alarm triggers
	 */
	async alarm(): Promise<void> {
		// TODO: Implement alarm logic
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade handling
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Accept the WebSocket connection using hibernation API
			this.ctx.acceptWebSocket(server)

			return new Response(null, {
				status: 101,
				webSocket: client,
			})
		}

		return new Response('Fulcrum Durable Object', { status: 200 })
	}
}
