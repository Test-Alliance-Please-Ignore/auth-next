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
	if (error instanceof Error) {
		return {
			message: error.message || error.name || 'unknown_error',
			name: error.name,
			stack: error.stack,
			cause:
				error.cause instanceof Error
					? error.cause.message
					: error.cause !== undefined
						? String(error.cause)
						: undefined,
		}
	}

	return {
		message: toErrorMessage(error),
	}
}
