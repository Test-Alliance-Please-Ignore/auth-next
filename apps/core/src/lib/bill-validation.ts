import { z } from 'zod'

export const billEntityIdSchema = z.string().trim().min(1).max(64)
const MAX_AMOUNT_INTEGER_DIGITS = 15
const amountPattern = new RegExp(`^\\d{1,${MAX_AMOUNT_INTEGER_DIGITS}}(?:\\.\\d{1,2})?$`)

export const billAmountSchema = z
	.string()
	.trim()
	.regex(amountPattern, 'Amount must be a valid ISK amount with at most two decimals')
	.refine((value) => /[1-9]/.test(value), 'Amount must be greater than zero')
export const billFeeAmountSchema = z
	.string()
	.trim()
	.regex(amountPattern, 'Late fee amount must be a valid amount with at most two decimals')
export const billDateStringSchema = z.string().trim().min(1, 'Due date is required')

export const manualBillCreateSchema = z
	.object({
		payerId: billEntityIdSchema,
		payerType: z.enum(['character', 'corporation', 'group']),
		payeeId: billEntityIdSchema,
		payeeType: z.enum(['character', 'corporation']),
		title: z.string().trim().min(1).max(200),
		description: z.string().max(2000).optional(),
		amount: billAmountSchema,
		dueDate: billDateStringSchema,
		lateFeeType: z.enum(['none', 'static', 'percentage']).optional(),
		lateFeeAmount: billFeeAmountSchema.optional(),
		lateFeeCompounding: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
		groupBillOptions: z
			.object({
				includeOwner: z.boolean(),
				includeAdmins: z.boolean(),
				includeMembers: z.boolean(),
			})
			.optional(),
	})
	.refine((data) => data.lateFeeType !== 'percentage' || Number(data.lateFeeAmount ?? '0') <= 100, {
		message: 'Percentage late fees must be between 0 and 100',
	})

export const manualBillUpdateSchema = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		description: z.string().max(2000).optional(),
		amount: billAmountSchema.optional(),
		dueDate: billDateStringSchema.optional(),
		lateFeeType: z.enum(['none', 'static', 'percentage']).optional(),
		lateFeeAmount: billFeeAmountSchema.optional(),
		lateFeeCompounding: z.enum(['none', 'daily', 'weekly', 'monthly']).optional(),
	})
	.refine((data) => Object.keys(data).length > 0, 'At least one bill field must be provided')
	.refine((data) => data.lateFeeType !== 'percentage' || Number(data.lateFeeAmount ?? '0') <= 100, {
		message: 'Percentage late fees must be between 0 and 100',
	})

/** Escape user input before adding a PostgreSQL prefix wildcard. */
export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
