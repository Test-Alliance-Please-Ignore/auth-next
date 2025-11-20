/**
 * @repo/fulcrum
 *
 * Shared types and interfaces for the Fulcrum Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

import type { DurableObject } from 'cloudflare:workers'

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
	 * @param characterId - EVE character ID
	 * @param requestorUserId - User requesting the report
	 * @param requestorCorporationId - Corporation on whose behalf the report is being run
	 * @returns Report UUID
	 */
	createCharacterReport(
		characterId: string,
		requestorUserId: string,
		requestorCorporationId: string,
	): Promise<string>

	/**
	 * Get character report status and metadata
	 * @param reportId - Report UUID
	 * @returns Report metadata or null if not found
	 */
	getReportStatus(reportId: string): Promise<CharacterReportMetadata | null>

	/**
	 * Get character report HTML content
	 * Updates viewed_at timestamp on first view
	 * @param reportId - Report UUID
	 * @returns HTML content or null if not found/expired
	 */
	getReportHtml(reportId: string): Promise<string | null>

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
}
