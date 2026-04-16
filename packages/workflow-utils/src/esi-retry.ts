/**
 * ESI retry utilities for Cloudflare Workflows
 *
 * All retry logic in this codebase is ESI-scoped — whether that's a step.do()
 * wrapper or an inner retryWithBackoff() loop. This module consolidates both
 * into a single canonical implementation that understands ESI error shapes,
 * honors Retry-After headers, and skips retries on permanent auth failures.
 *
 * Note: The ESI Durable Object handles Retry-After headers internally and
 * retries up to 5 times before surfacing an error. retryWithBackoff() here
 * covers sub-call retries (enrichment lookups, paginated fetches, etc.) that
 * escape the DO's own loop. withEsiRetryClassification() covers step.do()
 * callbacks where Cloudflare Workflows manages the outer retry cycle.
 */

import { NonRetryableError } from 'cloudflare:workflows'

const ESI_RATE_LIMIT_SLEEP_FALLBACK_SECONDS = 30
const ESI_RATE_LIMIT_SLEEP_MAX_SECONDS = 60

// ─── Error classification ────────────────────────────────────────────────────

/**
 * Parse ESI error metadata JSON embedded in an error message.
 * ESI errors carry context as: " | metadata={\"status\":429,...}"
 * Returns null if no metadata marker is found or parsing fails.
 */
export function parseEsiErrorMetadata(message: string): Record<string, unknown> | null {
	const marker = ' | metadata='
	const idx = message.lastIndexOf(marker)
	if (idx === -1) return null

	const text = message.slice(idx + marker.length).trim()
	if (!text) return null

	try {
		const parsed = JSON.parse(text)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
	} catch {
		return null
	}
}

function getEsiStatusFromError(error: unknown): number | null {
	if (!(error instanceof Error)) return null
	const metadata = parseEsiErrorMetadata(error.message)
	const status = metadata?.status
	return typeof status === 'number' ? status : null
}

/**
 * Check if an error is a retriable ESI rate limit (420 or 429).
 */
export function isEsiRateLimitError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	const status = getEsiStatusFromError(error)
	if (status === 420 || status === 429) return true
	const msg = error.message.toLowerCase()
	return msg.includes('420') || msg.includes('429') || msg.includes('rate limit')
}

/**
 * Check if an error is a permanent ESI failure that should never be retried.
 * Covers auth failures (400/401/403) and deleted characters.
 */
export function isPermanentEsiFailure(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	const status = getEsiStatusFromError(error)
	if (status === 404) return true
	if (status === 400 || status === 401 || status === 403) return true

	// CharacterDeletedError by class name (avoids cross-package instanceof issues)
	if (error.name === 'CharacterDeletedError') return true

	const msg = error.message.toLowerCase()

	// Match actual ESI error message: "Character 12345 has been deleted"
	if (msg.includes('has been deleted')) return true
	if (msg.includes('character deleted') || msg.includes('character_deleted')) return true

	// Generic 404 from ESI — character/resource does not exist, retrying won't help
	if (msg.includes('esi request failed: 404')) return true

	const isAuthStatus =
		msg.includes('esi request failed: 400') ||
		msg.includes('esi request failed: 401') ||
		msg.includes('esi request failed: 403')

	if (!isAuthStatus) return false

	return (
		msg.includes('unauthorized') ||
		msg.includes('forbidden') ||
		msg.includes('bad request') ||
		msg.includes('no token provided') ||
		msg.includes('invalid token') ||
		msg.includes('token expired')
	)
}

/**
 * Extract how many seconds to sleep before retrying a 429 response.
 * Reads retryAfterSeconds and errorLimitResetSeconds from ESI metadata.
 * Returns null if the error is not a 429 or carries no metadata.
 */
export function extractEsiRateLimitSleepSeconds(
	message: string,
	fallbackSeconds = ESI_RATE_LIMIT_SLEEP_FALLBACK_SECONDS,
	maxSeconds = ESI_RATE_LIMIT_SLEEP_MAX_SECONDS
): number | null {
	const metadata = parseEsiErrorMetadata(message)
	if (!metadata) return null

	if (metadata.status !== 429) return null

	const retryAfter = typeof metadata.retryAfterSeconds === 'number' ? metadata.retryAfterSeconds : undefined
	const errorLimitReset = typeof metadata.errorLimitResetSeconds === 'number' ? metadata.errorLimitResetSeconds : undefined
	const recommended = retryAfter ?? errorLimitReset ?? fallbackSeconds

	return Math.max(1, Math.min(maxSeconds, recommended))
}

// ─── Jitter ──────────────────────────────────────────────────────────────────

/**
 * Add ±25% random jitter to a delay to avoid thundering herds.
 */
export function withJitter(delayMs: number): number {
	return delayMs + (Math.random() * 2 - 1) * delayMs * 0.25
}

// ─── step.do() wrapper ───────────────────────────────────────────────────────

/**
 * Wrap a step.do() callback with ESI-aware retry classification.
 *
 * - Throws NonRetryableError for permanent auth failures so the Workflow
 *   does not waste retries on bad/revoked tokens or deleted characters.
 * - Sleeps for the ESI-specified retry-after duration on 429 before
 *   rethrowing, so the next Workflow retry attempt finds the rate limit lifted.
 * - All other errors are rethrown as-is for the Workflow to handle.
 *
 * @example
 * ```typescript
 * const result = await step.do('fetch-data', esiFetchStepConfig, () =>
 *   withEsiRetryClassification('fetch-data', () => stub.fetchData(characterId))
 * )
 * ```
 */
export async function withEsiRetryClassification<T>(
	stepName: string,
	run: () => Promise<T>,
	options: {
		rateLimitFallbackSeconds?: number
		rateLimitMaxSeconds?: number
	} = {}
): Promise<T> {
	const { rateLimitFallbackSeconds, rateLimitMaxSeconds } = options
	try {
		return await run()
	} catch (error) {
		if (isPermanentEsiFailure(error)) {
			const message = error instanceof Error ? error.message : String(error)
			throw new NonRetryableError(`${stepName}: ${message}`)
		}

		const message = error instanceof Error ? error.message : String(error)
		const sleepSeconds = extractEsiRateLimitSleepSeconds(message, rateLimitFallbackSeconds, rateLimitMaxSeconds)
		if (sleepSeconds !== null) {
			await new Promise((resolve) => setTimeout(resolve, sleepSeconds * 1000))
		}

		throw error
	}
}

// ─── Sub-call retry loop ─────────────────────────────────────────────────────

/**
 * Retry an ESI sub-call with exponential backoff and jitter.
 *
 * Use this for inner loops within a step — paginated fetches, enrichment
 * lookups, etc. — where you want automatic retry without surfacing errors
 * to the Workflow's own retry mechanism.
 *
 * Only ESI rate limit errors (429/420) are retried.
 * Permanent failures (auth errors, deleted characters) propagate immediately.
 * All other errors propagate immediately.
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options: {
		maxRetries?: number
		initialDelayMs?: number
		maxDelayMs?: number
		backoffMultiplier?: number
		onRetry?: (attempt: number, error: Error, delayMs: number) => void
	} = {}
): Promise<T> {
	const {
		maxRetries = 5,
		initialDelayMs = 1000,
		maxDelayMs = 60000,
		backoffMultiplier = 2,
		onRetry,
	} = options

	let lastError: Error
	let delay = initialDelayMs

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn()
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error))

			if (isPermanentEsiFailure(error)) throw lastError
			if (attempt >= maxRetries) throw lastError
			if (!isEsiRateLimitError(error)) throw lastError

			const jitteredDelay = Math.min(withJitter(delay), maxDelayMs)
			onRetry?.(attempt + 1, lastError, jitteredDelay)
			await new Promise((resolve) => setTimeout(resolve, jitteredDelay))
			delay = Math.min(delay * backoffMultiplier, maxDelayMs)
		}
	}

	throw lastError!
}
