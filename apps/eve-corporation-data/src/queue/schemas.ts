import { z } from 'zod'

/**
 * Base schema fields shared by all queue messages
 */
const baseMessageSchema = z.object({
	/** Corporation ID to refresh */
	corporationId: z.string(),
	/** Unix timestamp (milliseconds) when the refresh was requested */
	timestamp: z.number().int().positive(),
	/** Optional ID of the system/user that requested the refresh */
	requesterId: z.string().optional(),
})

/**
 * Base message type for all queue messages
 */
export type BaseMessage = z.infer<typeof baseMessageSchema>

/**
 * Public corporation info refresh message
 */
export const publicRefreshMessageSchema = baseMessageSchema

/**
 * Members roster refresh message
 */
export const membersRefreshMessageSchema = baseMessageSchema

/**
 * Member tracking refresh message
 */
export const memberTrackingRefreshMessageSchema = baseMessageSchema

/**
 * Wallets refresh message (all 7 divisions)
 */
export const walletsRefreshMessageSchema = baseMessageSchema

/**
 * Wallet journal refresh message
 * Optionally filter by division (1-7)
 */
export const walletJournalRefreshMessageSchema = baseMessageSchema.extend({
	division: z.number().int().min(1).max(7).optional(),
})

/**
 * Wallet transactions refresh message
 * Optionally filter by division (1-7)
 */
export const walletTransactionsRefreshMessageSchema = baseMessageSchema.extend({
	division: z.number().int().min(1).max(7).optional(),
})

/**
 * Assets refresh message
 */
export const assetsRefreshMessageSchema = baseMessageSchema

/**
 * Structures refresh message
 */
export const structuresRefreshMessageSchema = baseMessageSchema

/**
 * Market orders refresh message
 */
export const ordersRefreshMessageSchema = baseMessageSchema

/**
 * Contracts refresh message
 */
export const contractsRefreshMessageSchema = baseMessageSchema

/**
 * Industry jobs refresh message
 */
export const industryJobsRefreshMessageSchema = baseMessageSchema

/**
 * Killmails refresh message
 */
export const killmailsRefreshMessageSchema = baseMessageSchema

// Type exports for use in handlers and tests
export type PublicRefreshMessage = z.infer<typeof publicRefreshMessageSchema>
export type MembersRefreshMessage = z.infer<typeof membersRefreshMessageSchema>
export type MemberTrackingRefreshMessage = z.infer<
	typeof memberTrackingRefreshMessageSchema
>
export type WalletsRefreshMessage = z.infer<typeof walletsRefreshMessageSchema>
export type WalletJournalRefreshMessage = z.infer<typeof walletJournalRefreshMessageSchema>
export type WalletTransactionsRefreshMessage = z.infer<
	typeof walletTransactionsRefreshMessageSchema
>
export type AssetsRefreshMessage = z.infer<typeof assetsRefreshMessageSchema>
export type StructuresRefreshMessage = z.infer<typeof structuresRefreshMessageSchema>
export type OrdersRefreshMessage = z.infer<typeof ordersRefreshMessageSchema>
export type ContractsRefreshMessage = z.infer<typeof contractsRefreshMessageSchema>
export type IndustryJobsRefreshMessage = z.infer<typeof industryJobsRefreshMessageSchema>
export type KillmailsRefreshMessage = z.infer<typeof killmailsRefreshMessageSchema>
