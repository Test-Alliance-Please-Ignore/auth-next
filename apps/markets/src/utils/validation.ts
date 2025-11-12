import { z } from 'zod'

/**
 * Validation schemas for API requests using Zod
 */

// Numeric ID validation (EVE entity IDs are numeric strings)
export const NumericIdSchema = z.string().regex(/^\d+$/, 'Must be a numeric string')

// UUID validation
export const UuidSchema = z.string().uuid('Must be a valid UUID')

// Location type validation
export const LocationTypeSchema = z.enum(['region', 'structure'])

// Snapshot status validation
export const SnapshotStatusSchema = z.enum(['pending', 'complete', 'failed'])

// Order type validation
export const OrderTypeSchema = z.enum(['buy', 'sell', 'all'])

// Pagination limit validation
export const LimitSchema = z.coerce
	.number()
	.int('Must be an integer')
	.min(1, 'Must be at least 1')
	.max(500, 'Must be at most 500')
	.default(100)

// Cursor validation (base64 encoded JSON)
export const CursorSchema = z.string().optional()

/**
 * Schema for batch prices request body
 */
export const BatchPricesRequestSchema = z.object({
	typeIds: z
		.array(NumericIdSchema)
		.min(1, 'Must provide at least 1 type ID')
		.max(500, 'Maximum 500 type IDs per request'),
	snapshotId: UuidSchema.optional(),
})

/**
 * Schema for snapshots list query parameters
 */
export const SnapshotsQuerySchema = z.object({
	locationType: LocationTypeSchema.optional(),
	status: SnapshotStatusSchema.optional(),
	limit: LimitSchema,
	cursor: CursorSchema,
})

/**
 * Schema for orders query parameters
 */
export const OrdersQuerySchema = z.object({
	typeId: NumericIdSchema.optional(),
	orderType: OrderTypeSchema.optional(),
	locationId: NumericIdSchema.optional(),
	limit: LimitSchema,
	cursor: CursorSchema,
})

/**
 * Schema for type search query parameters
 */
export const TypeSearchQuerySchema = z.object({
	locationType: LocationTypeSchema.optional(),
	limit: LimitSchema,
	cursor: CursorSchema,
})

/**
 * Validate entity ID (exists and is numeric)
 */
export function validateEntityId(
	id: string,
	paramName: string
): { valid: boolean; error?: string } {
	if (!id || id.trim() === '') {
		return { valid: false, error: `${paramName} is required` }
	}

	if (!/^\d+$/.test(id)) {
		return { valid: false, error: `${paramName} must be a numeric ID` }
	}

	return { valid: true }
}

/**
 * Format Zod validation errors for API response
 */
export function formatZodErrors(error: z.ZodError): string[] {
	return error.issues.map((err) => {
		const path = err.path.join('.')
		return path ? `${path}: ${err.message}` : err.message
	})
}
