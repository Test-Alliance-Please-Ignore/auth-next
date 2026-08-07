import { HTTPException } from 'hono/http-exception'

import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Generates a new HTTPException with the given status and message as a JSON response.
 *
 * **Example:** `throw newHTTPException(401, 'unauthorized')`
 */
export function newHTTPException(status: ContentfulStatusCode, message: string): HTTPException {
	return new HTTPException(status, { message })
}

export interface APIError {
	success: false
	error: {
		message: string
	}
}

export interface ErrorLogDetails {
	message: string
	name?: string
	stack?: string
	cause?: string
	code?: string | number
	detail?: string
	hint?: string
	severity?: string
	position?: string | number
	query?: string
	paramsCount?: number
	parameterColumns?: Array<string | null>
	parameterValues?: unknown[]
	causeName?: string
	causeStack?: string
	causeCode?: string | number
	causeDetail?: string
	causeHint?: string
	causeSeverity?: string
}

type ErrorRecord = Record<string, unknown>

function asErrorRecord(value: unknown): ErrorRecord | null {
	return value && typeof value === 'object' ? (value as ErrorRecord) : null
}

function asLogValue(value: unknown): string | number | undefined {
	return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function asLogString(value: unknown): string | undefined {
	const logValue = asLogValue(value)
	return logValue === undefined ? undefined : String(logValue)
}

function normalizeQuery(query: string): string {
	return query.replace(/\s+/g, ' ').slice(0, 2_000)
}

const SENSITIVE_DATABASE_COLUMNS = new Set([
	'access_token',
	'api_key',
	'authorization',
	'client_secret',
	'credential',
	'credentials',
	'key',
	'password',
	'private_key',
	'refresh_token',
	'session_token',
])

const LONG_TEXT_DATABASE_COLUMNS = new Set([
	'content',
	'context_text',
	'description',
	'error_message',
	'external_metadata',
	'full_description',
	'message',
	'message_template',
	'metadata',
	'note',
	'note_text',
	'notes',
	'original_content',
	'reason',
	'review_notes',
	'source_metadata',
])

const MAX_DATABASE_STRING_LENGTH = 500
const MAX_DATABASE_LONG_TEXT_LENGTH = 1_000

function normalizeColumnName(column: string): string {
	return column.replaceAll('"', '').trim().toLowerCase()
}

function getColumnFromValueList(
	query: string,
	index: number,
	pattern: RegExp
): string | null | undefined {
	const match = pattern.exec(query)
	if (!match) return undefined

	const columns: string[] = match[1]?.split(',').map(normalizeColumnName) ?? []
	const placeholders: string[] = match[2]?.match(/\$\d+/g) ?? []
	return columns[placeholders.indexOf(`$${index + 1}`)] ?? null
}

function getDatabaseParameterColumn(query: string | undefined, index: number): string | null {
	if (!query) return null

	const valueListPatterns = [
		/\binsert\s+into\s+[^()]+\(([^)]+)\)\s*values\s*\(([^)]+)\)/i,
		/\bwith\s+\w+\s*\(([^)]+)\)\s+as\s*\(\s*values\s*\(([^)]+)\)/i,
	]
	for (const pattern of valueListPatterns) {
		const column = getColumnFromValueList(query, index, pattern)
		if (column !== undefined) return column
	}

	const placeholder = new RegExp(`\\$${index + 1}(?!\\d)`)
	const match = placeholder.exec(query)
	if (!match) return null

	const precedingQuery = query.slice(0, match.index)
	const boundaryMatches = [...precedingQuery.matchAll(/\b(?:set|where|values|and|or)\b|,/gi)]
	const lastBoundary = boundaryMatches.at(-1)?.index ?? Math.max(0, precedingQuery.length - 500)
	const parameterContext = precedingQuery.slice(lastBoundary, match.index)
	const columnMatch = parameterContext.match(
		/(?:^|\b(?:set|where|and|or)\b|,)\s*"?([a-z_][a-z0-9_]*)"?\s*(?:=|in\s*\(|is(?:\s+not)?\s*)[^,]*$/i
	)
	return columnMatch?.[1] ? normalizeColumnName(columnMatch[1]) : null
}

function formatParameterValue(value: unknown, column: string | null): unknown {
	if (column && SENSITIVE_DATABASE_COLUMNS.has(column)) return '<redacted>'
	if (
		value === null ||
		value === undefined ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	) {
		return value
	}
	if (typeof value === 'bigint') return String(value)
	if (value instanceof Date) return value.toISOString()

	try {
		const serialized = typeof value === 'string' ? value : JSON.stringify(value)
		const maxLength =
			column && LONG_TEXT_DATABASE_COLUMNS.has(column)
				? MAX_DATABASE_LONG_TEXT_LENGTH
				: MAX_DATABASE_STRING_LENGTH
		if (serialized.length <= maxLength) return serialized
		return `${serialized.slice(0, maxLength)}...[truncated]`
	} catch {
		return `[${typeof value}]`
	}
}

function getDatabaseParameterColumns(
	params: unknown[] | undefined,
	query: string | undefined
): Array<string | null> | undefined {
	return params?.map((_, index) => getDatabaseParameterColumn(query, index))
}

function getDatabaseParameterValues(
	params: unknown[] | undefined,
	parameterColumns: Array<string | null> | undefined
): unknown[] | undefined {
	return params?.map((value, index) =>
		formatParameterValue(value, parameterColumns?.[index] ?? null)
	)
}

function getDatabaseQuery(message: string, error: ErrorRecord): string | undefined {
	if (typeof error.query === 'string') {
		return normalizeQuery(error.query)
	}

	if (!message.startsWith('Failed query:')) {
		return undefined
	}

	const paramsIndex = message.indexOf('\nparams:')
	return normalizeQuery(paramsIndex >= 0 ? message.slice(0, paramsIndex) : message)
}

function getCauseMessage(cause: unknown): string | undefined {
	if (cause instanceof Error) return cause.message || cause.name
	if (cause === undefined || cause === null) return undefined
	return String(cause)
}

/**
 * Normalize unknown thrown values into a safe loggable message.
 * This avoids passing complex/proxy objects to logger/console paths.
 */
export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * Normalize unknown thrown values into structured logging fields.
 * Ensures Cloudflare logs always include a stable message field.
 */
export function toErrorLogDetails(error: unknown): ErrorLogDetails {
	const record = asErrorRecord(error) ?? {}
	const message =
		error instanceof Error
			? error.message || error.name || 'unknown_error'
			: typeof record.message === 'string'
				? record.message
				: toErrorMessage(error)
	const causeRecord = asErrorRecord(record.cause)
	const causeMessage = getCauseMessage(record.cause)
	const paramsCount = Array.isArray(record.params) ? record.params.length : undefined
	const query = getDatabaseQuery(message, record)
	const params = Array.isArray(record.params) ? record.params : undefined
	const parameterColumns = getDatabaseParameterColumns(params, query)

	return {
		message: message.startsWith('Failed query:') ? message.split('\nparams:')[0] : message,
		name: error instanceof Error ? error.name : undefined,
		stack: error instanceof Error ? error.stack : undefined,
		cause: causeMessage,
		code: asLogValue(record.code) ?? asLogValue(causeRecord?.code),
		detail: asLogString(record.detail) ?? asLogString(causeRecord?.detail),
		hint: asLogString(record.hint) ?? asLogString(causeRecord?.hint),
		severity: asLogString(record.severity) ?? asLogString(causeRecord?.severity),
		position: asLogValue(record.position) ?? asLogValue(causeRecord?.position),
		query,
		paramsCount,
		parameterColumns,
		parameterValues: getDatabaseParameterValues(params, parameterColumns),
		causeName: causeRecord?.name as string | undefined,
		causeStack: causeRecord?.stack as string | undefined,
		causeCode: asLogValue(causeRecord?.code),
		causeDetail: asLogString(causeRecord?.detail),
		causeHint: asLogString(causeRecord?.hint),
		causeSeverity: asLogString(causeRecord?.severity),
	}
}
