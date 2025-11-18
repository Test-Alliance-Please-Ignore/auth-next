import type {
	CorporationAsset,
	CorporationContract,
	CorporationIndustryJob,
	CorporationKillmail,
	CorporationMembers,
	CorporationMemberTracking,
	CorporationOrder,
	CorporationStructure,
	CorporationWallet,
	CorporationWalletJournalEntry,
	CorporationWalletTransaction,
} from './types'

/**
 * @repo/esi
 *
 * Shared types and interfaces for the Esi Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// Export ESI response types
export * from './types'

/**
 * Public RPC interface for Esi Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Esi } from '@repo/esi'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Esi>(env.ESI, 'default')
 * const members = await stub.fetchMembers(corporationId)
 * ```
 */
export interface Esi {
	fetchMembers(corporationId: string): Promise<CorporationMembers>
	fetchMemberTracking(corporationId: string): Promise<CorporationMemberTracking[]>
	fetchWallets(corporationId: string): Promise<CorporationWallet[]>
	fetchWalletJournal(
		corporationId: string,
		division: number
	): Promise<CorporationWalletJournalEntry[]>
	fetchWalletTransactions(
		corporationId: string,
		division: number
	): Promise<CorporationWalletTransaction[]>
	fetchAssets(corporationId: string): Promise<CorporationAsset[]>
	fetchStructures(corporationId: string): Promise<CorporationStructure[]>
	fetchOrders(corporationId: string): Promise<CorporationOrder[]>
	fetchContracts(corporationId: string): Promise<CorporationContract[]>
	fetchIndustryJobs(corporationId: string): Promise<CorporationIndustryJob[]>
	fetchKillmails(corporationId: string): Promise<CorporationKillmail[]>
}
