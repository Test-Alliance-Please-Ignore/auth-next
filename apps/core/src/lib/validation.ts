/**
 * Shared validation schemas and helpers for API routes
 */

import { z } from 'zod'

/**
 * Pagination query parameters schema
 * - limit: 1-1000, default 50
 * - offset: >= 0, default 0
 */
export const paginationSchema = z.object({
	limit: z.coerce
		.number()
		.int('Limit must be an integer')
		.min(1, 'Limit must be at least 1')
		.max(1000, 'Limit cannot exceed 1000')
		.optional()
		.default(50),
	offset: z.coerce
		.number()
		.int('Offset must be an integer')
		.min(0, 'Offset must be non-negative')
		.optional()
		.default(0),
})

export type PaginationParams = z.infer<typeof paginationSchema>

/**
 * Helper to validate and parse pagination parameters from query string
 * Returns validated params or error response data
 */
export function validatePagination(
	limit?: string,
	offset?: string
):
	| { success: true; data: PaginationParams }
	| { success: false; error: string; status: 400 | 500 } {
	const result = paginationSchema.safeParse({
		limit,
		offset,
	})

	if (!result.success) {
		const firstError = result.error.issues[0]
		return {
			success: false,
			error: firstError?.message || 'Invalid pagination parameters',
			status: 400,
		}
	}

	return {
		success: true,
		data: result.data,
	}
}
