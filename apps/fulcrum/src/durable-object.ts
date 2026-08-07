import { DurableObject } from 'cloudflare:workers'

import { getEsiInstanceForCharacter } from '@repo/esi'
import { DEFAULT_RETENTION_DAYS, RETENTION_POLICIES } from '@repo/fulcrum'
import { logger } from '@repo/hono-helpers'
import { createWorkflow } from '@repo/workflow-utils'

import { createDb } from './db'
import * as queries from './db/queries'
import { sendReportStartedDM } from './lib/discord-webhook'
import { resolveReportMetadata } from './lib/report-metadata'
import { stripHtmlToPlainText } from './workflows/processors/helpers/html-stripper'

import type {
	CharacterReportMetadata,
	CreateBulkReportOptions,
	CreateReportOptions,
	Fulcrum,
	ListReportsFilters,
	ReportManifest,
	ReportSectionName,
} from '@repo/fulcrum'
import type { Env } from './context'
import type { DbClient } from './db/queries'
import type { WorkflowParams } from './workflows/character-report.workflow.js'

const CHUNK_SIZE = 500
const REPORT_CHUNK_CACHE_TTL_MS = 5 * 60 * 1000
const REPORT_CHUNK_CACHE_MAX_ENTRIES = 64

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
	private reportChunkCache = new Map<
		string,
		{ rows: unknown[]; exists: boolean; expiresAt: number }
	>()

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
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

	private async getReportChunk(
		r2Key: string,
		section: ReportSectionName,
		chunkIndex: number
	): Promise<unknown[] | null> {
		const cacheKey = `${r2Key}/sections/${section}/chunk-${chunkIndex}.json`
		const now = Date.now()
		const cached = this.reportChunkCache.get(cacheKey)
		if (cached && cached.expiresAt > now) {
			return cached.exists ? cached.rows : null
		}
		if (cached) this.reportChunkCache.delete(cacheKey)

		const object = await this.env.CHARACTER_REPORTS.get(cacheKey)
		const exists = Boolean(object)
		const rows = object ? await object.json<unknown[]>() : []
		if (this.reportChunkCache.size >= REPORT_CHUNK_CACHE_MAX_ENTRIES) {
			const oldestKey = this.reportChunkCache.keys().next().value
			if (oldestKey) this.reportChunkCache.delete(oldestKey)
		}
		this.reportChunkCache.set(cacheKey, {
			rows,
			exists,
			expiresAt: now + REPORT_CHUNK_CACHE_TTL_MS,
		})
		return exists ? rows : null
	}

	/**
	 * RPC: Create a new character report
	 * Creates database record, queues workflow, returns report ID
	 */
	async createCharacterReport(options: CreateReportOptions): Promise<string> {
		const {
			characterId,
			requestorUserId,
			requestorCorporationId,
			requestSource,
			applicationId,
			targetUserId,
			sendDm = true,
		} = options
		const db = this.getDb()

		// Prevent duplicate concurrent reports for the same character across all requestors.
		// Reuse the existing in-progress report so HR and auditors share a single workflow state.
		const existingInProgress = await queries.getInProgressReportForCharacter(db, characterId)
		if (existingInProgress) {
			this.logger.info('Reusing existing in-progress report', {
				characterId,
				reportId: existingInProgress.id,
				status: existingInProgress.status,
				requestorUserId,
			})
			return existingInProgress.id
		}

		// Generate unique report ID
		const reportId = crypto.randomUUID()

		// Compute retention from server-side policy
		const retentionDays = RETENTION_POLICIES[requestSource] ?? DEFAULT_RETENTION_DAYS
		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + retentionDays)

		// Create database record
		await queries.createCharacterReport(db, {
			id: reportId,
			characterId,
			requestorUserId,
			requestorCorporationId,
			requestSource,
			applicationId,
			retentionDays,
			expiresAt,
		})

		// Send Discord DM notification (non-blocking)
		if (sendDm) {
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
					await sendReportStartedDM(this.env, requestorUserId, metadata)
				}
			} catch (error) {
				// Log but don't fail - DM failures should not block report creation
				logger.error('[Fulcrum DO] Failed to send report started DM', {
					reportId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// Start workflow
		const workflowParams: WorkflowParams = {
			reportId,
			characterId,
			targetUserId,
			sendDm,
		}
		try {
			const workflowInstance = await createWorkflow(this.env.CHARACTER_REPORT_WORKFLOW, {
				id: `${characterId}-${reportId}-${Date.now()}`,
				params: workflowParams,
			})
			await queries.updateReportStatus(db, reportId, 'pending', {
				workflowInstanceId: workflowInstance.id,
			})
		} catch (error) {
			// Mark report as failed so it doesn't stay stuck as "pending"
			logger.error('[Fulcrum DO] Failed to create workflow', {
				reportId,
				characterId,
				error: error instanceof Error ? error.message : String(error),
			})
			await queries.updateReportStatus(db, reportId, 'failed', {
				errorMessage: `Failed to start workflow: ${error instanceof Error ? error.message : String(error)}`,
			})
			throw error
		}

		return reportId
	}

	/**
	 * RPC: Create a bulk character report batch.
	 * Starts a parent batch workflow that fans out child character-report workflows.
	 */
	async createBulkCharacterReports(options: CreateBulkReportOptions): Promise<{ batchId: string }> {
		const {
			characterIds,
			requestorUserId,
			requestorCorporationId,
			requestSource,
			applicationId,
			sendDm = true,
			targetUserId,
		} = options

		const dedupedCharacterIds = [...new Set(characterIds.map((id) => id.trim()).filter(Boolean))]
		if (dedupedCharacterIds.length === 0) {
			throw new Error('At least one characterId is required for bulk report generation')
		}

		const workflowInstance = await createWorkflow(this.env.BULK_CHARACTER_REPORT_WORKFLOW, {
			id: `bulk-${requestorUserId}-${Date.now()}-${crypto.randomUUID()}`,
			params: {
				characterIds: dedupedCharacterIds,
				requestorUserId,
				requestorCorporationId,
				requestSource,
				applicationId,
				sendDm,
				targetUserId,
			},
		})

		this.logger.info('Started bulk character report workflow', {
			batchId: workflowInstance.id,
			requestorUserId,
			requestorCorporationId,
			characterCount: dedupedCharacterIds.length,
			sendDm,
			targetUserId,
		})

		return { batchId: workflowInstance.id }
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
			requestSource: (report.requestSource ?? 'hr') as CharacterReportMetadata['requestSource'],
			applicationId: report.applicationId ?? undefined,
			retentionDays: report.retentionDays ?? 7,
			workflowInstanceId: report.workflowInstanceId ?? undefined,
			createdAt: report.createdAt.toISOString(),
			updatedAt: report.updatedAt.toISOString(),
			expiresAt: report.expiresAt?.toISOString(),
			viewedAt: report.viewedAt?.toISOString(),
			errorMessage: report.errorMessage ?? undefined,
		}
	}

	/**
	 * RPC: List character reports with optional filters
	 * Returns array of report metadata
	 */
	async listReports(
		filters?: ListReportsFilters,
		limit = 50,
		offset = 0
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
			requestSource: (report.requestSource ?? 'hr') as CharacterReportMetadata['requestSource'],
			applicationId: report.applicationId ?? undefined,
			retentionDays: report.retentionDays ?? 7,
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
	async generateShareUrl(reportId: string, _expiresIn: number): Promise<string | null> {
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
	 * RPC: Check if a report is cancelled
	 * Returns true if the report status is 'cancelled', false otherwise
	 */
	async isReportCancelled(reportId: string): Promise<boolean> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		// Check if report exists and is cancelled
		return report?.status === 'cancelled'
	}

	/**
	 * RPC: Get the manifest of available sections for a report
	 * Returns the list of sections that were successfully generated
	 */
	async getReportSections(reportId: string): Promise<ReportManifest | null> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		if (!report || report.status !== 'completed') {
			return null
		}

		if (report.expiresAt && new Date() > report.expiresAt) {
			return null
		}

		if (!report.r2Key) {
			return null
		}

		// Fetch manifest from R2
		const manifestKey = `${report.r2Key}/manifest.json`
		const r2Object = await this.env.CHARACTER_REPORTS.get(manifestKey)
		if (!r2Object) {
			return null
		}

		return await r2Object.json<ReportManifest>()
	}

	/**
	 * RPC: Get processed data for a specific report section.
	 * Reads the manifest to determine whether the section is stored as a flat
	 * file or as chunked files, then fetches accordingly.
	 *
	 * - page omitted: returns full data (all chunks concatenated for chunked sections)
	 * - page provided without pageSize: returns one storage chunk
	 * - page provided with pageSize: returns one page across storage chunk boundaries
	 */
	async getReportSectionData(
		reportId: string,
		section: ReportSectionName,
		page?: number,
		pageSize?: number
	): Promise<unknown | null> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		if (!report || report.status !== 'completed') {
			return null
		}

		if (report.expiresAt && new Date() > report.expiresAt) {
			return null
		}

		if (!report.r2Key) {
			return null
		}

		// Read manifest to determine storage format
		const manifestKey = `${report.r2Key}/manifest.json`
		const manifestObj = await this.env.CHARACTER_REPORTS.get(manifestKey)
		const manifest = manifestObj
			? await manifestObj.json<{
					sections: Record<string, { chunks: number; totalCount: number }>
				}>()
			: null
		const meta = manifest?.sections?.[section]

		if (page !== undefined && pageSize !== undefined && meta && meta.chunks > 0) {
			const offset = page * pageSize
			const firstChunk = Math.floor(offset / CHUNK_SIZE)
			const lastChunk = Math.floor((offset + pageSize - 1) / CHUNK_SIZE)
			const chunkRows = await Promise.all(
				Array.from({ length: lastChunk - firstChunk + 1 }, (_, index) =>
					this.getReportChunk(report.r2Key!, section, firstChunk + index)
				)
			)
			if (chunkRows.some((rows) => rows === null)) {
				return null
			}
			const rows = (chunkRows as unknown[][]).flat()

			return {
				data: rows.slice(
					offset - firstChunk * CHUNK_SIZE,
					offset - firstChunk * CHUNK_SIZE + pageSize
				),
				page,
				pageSize,
				totalCount: meta.totalCount,
				totalPages: Math.ceil(meta.totalCount / pageSize),
			}
		}

		// Flat file (no manifest entry, chunks === 0, or no manifest at all)
		if (!meta || meta.chunks === 0) {
			const sectionKey = `${report.r2Key}/sections/${section}.json`
			const r2Object = await this.env.CHARACTER_REPORTS.get(sectionKey)
			return r2Object ? r2Object.json() : null
		}

		// Chunked: specific page requested
		if (page !== undefined) {
			const rows = await this.getReportChunk(report.r2Key!, section, page)
			if (!rows) return null
			return {
				data: rows,
				page,
				totalChunks: meta.chunks,
			}
		}

		// Chunked: fetch all chunks in parallel and concatenate
		const arrays = await Promise.all(
			Array.from({ length: meta.chunks }, (_, i) => this.getReportChunk(report.r2Key!, section, i))
		)

		return arrays.flatMap((rows) => rows ?? [])
	}

	/**
	 * RPC: Fetch a single mail's content on-demand from ESI.
	 * Updates the mails section in R2 so future reads include the body.
	 * Returns the plain-text body for immediate display.
	 */
	async fetchMailContent(reportId: string, mailId: string): Promise<string | null> {
		const db = this.getDb()
		const report = await queries.getReport(db, reportId)

		if (!report || report.status !== 'completed') {
			return null
		}

		if (report.expiresAt && new Date() > report.expiresAt) {
			return null
		}

		if (!report.r2Key) {
			return null
		}

		// Fetch mail content from ESI
		const esiStub = getEsiInstanceForCharacter(this.env.ESI, report.characterId)
		let body: string
		let bodyPlainText: string | undefined
		try {
			const content = await esiStub.fetchMailContent(report.characterId, mailId)
			if (!content?.body) return null
			body = content.body
			bodyPlainText = stripHtmlToPlainText(body)
		} catch (error) {
			this.logger.error('Failed to fetch mail content from ESI', {
				reportId,
				mailId,
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}

		// Return the content without persisting — R2 sections are immutable after generation
		return bodyPlainText ?? body
	}

	/**
	 * WebSocket message handler (Hibernation API)
	 * Called when a WebSocket message is received
	 */
	async webSocketMessage(_ws: WebSocket, _message: ArrayBuffer | string): Promise<void> {
		// TODO: Implement WebSocket message handling
	}

	/**
	 * WebSocket close handler (Hibernation API)
	 * Called when a WebSocket connection is closed
	 */
	async webSocketClose(
		_ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean
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
