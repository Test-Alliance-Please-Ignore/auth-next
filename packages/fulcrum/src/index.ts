/**
 * @repo/fulcrum
 *
 * Shared types and interfaces for the Fulcrum Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { DurableObject } from 'cloudflare:workers'

/**
 * Request sources for character reports.
 * Determines retention policy and audit context.
 */
export type ReportRequestSource = 'hr'
// Future sources: 'counter_intel' | 'scheduled' | 'manual'

/**
 * Server-side retention policies (days) per request source.
 * Callers never set retention directly — it's derived from requestSource.
 */
export const RETENTION_POLICIES: Record<ReportRequestSource, number> = {
	hr: 7,
	// counter_intel: 365,
	// scheduled: 365,
} as const

export const DEFAULT_RETENTION_DAYS = 7

/**
 * Options for creating a character report
 */
export interface CreateReportOptions {
	characterId: string
	requestorUserId: string
	requestorCorporationId: string
	requestSource: ReportRequestSource
	applicationId?: string
	targetUserId?: string
	sendDm?: boolean
}

export interface CreateBulkReportOptions {
	characterIds: string[]
	requestorUserId: string
	requestorCorporationId: string
	requestSource: ReportRequestSource
	applicationId?: string
	sendDm?: boolean
	targetUserId?: string
}

/**
 * Character report metadata
 */
export interface CharacterReportMetadata {
	id: string
	characterId: string
	characterName?: string
	status: string
	requestorUserId: string
	requestorCorporationId: string
	requestSource: ReportRequestSource
	applicationId?: string
	retentionDays: number
	workflowInstanceId?: string
	createdAt: string
	updatedAt: string
	expiresAt?: string
	viewedAt?: string
	errorMessage?: string
}

/**
 * Filters for listing character reports
 */
export interface ListReportsFilters {
	corporationId?: string
	characterId?: string
	status?: string
}

/**
 * Valid section names for character reports
 */
export type ReportSectionName =
	| 'public-info'
	| 'assets'
	| 'fitted-ships'
	| 'orders'
	| 'wallet-transactions'
	| 'wallet-journal'
	| 'mails'
	| 'contacts'
	| 'corp-history'
	| 'skills'
	| 'contracts'
	| 'notifications'
	| 'clones'
	| 'alerts'

/**
 * Metadata for a single section in a report manifest.
 * chunks === 0 means a flat file at sections/{name}.json (small or non-array sections).
 * chunks > 0 means chunked files at sections/{name}/chunk-{i}.json.
 */
export interface ReportSectionMeta {
	chunks: number
	totalCount: number
	truncated?: boolean // wallet-transactions only
}

/**
 * Report manifest listing available sections with their storage metadata.
 * Only sections that were successfully persisted appear as keys.
 */
export interface ReportManifest {
	reportId: string
	characterId: string
	sections: Partial<Record<ReportSectionName, ReportSectionMeta>>
	createdAt: string
}

/**
 * Public RPC interface for Fulcrum Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Fulcrum } from '@repo/fulcrum'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Fulcrum>(env.FULCRUM, 'default')
 * const reportId = await stub.createCharacterReport('123456', 'user1', 'corp1')
 * ```
 */
export interface Fulcrum extends DurableObject {
	/**
	 * Create a new character report
	 * @param options - Report creation options including characterId, requestor info, and request source
	 * @returns Report UUID
	 */
	createCharacterReport(options: CreateReportOptions): Promise<string>

	/**
	 * Create a new bulk character report batch.
	 * Starts child character-report workflows concurrently and returns the batch workflow id.
	 */
	createBulkCharacterReports(options: CreateBulkReportOptions): Promise<{ batchId: string }>

	/**
	 * Get character report status and metadata
	 * @param reportId - Report UUID
	 * @returns Report metadata or null if not found
	 */
	getReportStatus(reportId: string): Promise<CharacterReportMetadata | null>

	/**
	 * List character reports with optional filters
	 * @param filters - Optional filters for corporation, character, or status
	 * @param limit - Maximum number of results (default 50)
	 * @param offset - Pagination offset (default 0)
	 * @returns Array of report metadata
	 */
	listReports(
		filters?: ListReportsFilters,
		limit?: number,
		offset?: number,
	): Promise<CharacterReportMetadata[]>

	/**
	 * Generate a signed URL for sharing a character report
	 * @param reportId - Report UUID
	 * @param expiresIn - Expiration time in seconds
	 * @returns Signed URL or null if report not found
	 */
	generateShareUrl(reportId: string, expiresIn: number): Promise<string | null>

	/**
	 * Cancel a pending or processing character report
	 * @param reportId - Report UUID
	 * @returns true if cancelled, false if not found or already completed
	 */
	cancelReport(reportId: string): Promise<boolean>

	/**
	 * Check if a report is cancelled
	 * @param reportId - Report UUID
	 * @returns true if the report status is 'cancelled', false otherwise
	 */
	isReportCancelled(reportId: string): Promise<boolean>

	/**
	 * Get the manifest of available sections for a report
	 * @param reportId - Report UUID
	 * @returns Report manifest or null if not found
	 */
	getReportSections(reportId: string): Promise<ReportManifest | null>

	/**
	 * Get processed data for a specific report section.
	 * When page is omitted, all chunks are fetched and concatenated.
	 * When page is provided, only that chunk is returned with pagination envelope.
	 * @param reportId - Report UUID
	 * @param section - Section name
	 * @param page - Optional chunk index (0-based) for paginated access
	 * @returns Section JSON data or null if not found
	 */
	getReportSectionData(
		reportId: string,
		section: ReportSectionName,
		page?: number,
	): Promise<unknown | null>

	/**
	 * Fetch a single mail's content on-demand from ESI and update the R2 section.
	 * Used when the initial report only fetched content for the most recent N mails.
	 * @param reportId - Report UUID
	 * @param mailId - EVE mail ID
	 * @returns The mail body text (HTML) or null if not found
	 */
	fetchMailContent(reportId: string, mailId: string): Promise<string | null>
}
