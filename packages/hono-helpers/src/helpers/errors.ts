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

/**
 * Normalize unknown thrown values into a safe loggable message.
 * This avoids passing complex/proxy objects to logger/console paths.
 */
export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
