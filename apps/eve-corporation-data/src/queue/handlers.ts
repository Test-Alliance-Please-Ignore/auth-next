import type { EveCorporationData } from '@repo/eve-corporation-data'
import type {
	AssetsRefreshMessage,
	ContractsRefreshMessage,
	IndustryJobsRefreshMessage,
	KillmailsRefreshMessage,
	MembersRefreshMessage,
	MemberTrackingRefreshMessage,
	OrdersRefreshMessage,
	PublicRefreshMessage,
	StructuresRefreshMessage,
	WalletJournalRefreshMessage,
	WalletsRefreshMessage,
	WalletTransactionsRefreshMessage,
} from './schemas'

/**
 * Handle public corporation info refresh
 */
export async function handlePublicRefresh(
	stub: EveCorporationData,
	message: PublicRefreshMessage
): Promise<void> {
	await stub.fetchPublicData(message.corporationId)
}

/**
 * Handle members roster refresh
 */
export async function handleMembersRefresh(
	stub: EveCorporationData,
	message: MembersRefreshMessage
): Promise<void> {
	await stub.fetchCoreData(message.corporationId)
}

/**
 * Handle member tracking refresh
 */
export async function handleMemberTrackingRefresh(
	stub: EveCorporationData,
	message: MemberTrackingRefreshMessage
): Promise<void> {
	await stub.fetchCoreData(message.corporationId)
}

/**
 * Handle wallets refresh (all 7 divisions)
 */
export async function handleWalletsRefresh(
	stub: EveCorporationData,
	message: WalletsRefreshMessage
): Promise<void> {
	// Fetch wallet balances for all 7 divisions in parallel
	const results = await Promise.allSettled(
		[1, 2, 3, 4, 5, 6, 7].map((div) => stub.fetchFinancialData(message.corporationId, div))
	)

	// Check if any succeeded
	const succeeded = results.filter((r) => r.status === 'fulfilled')
	if (succeeded.length === 0) {
		throw new Error('Failed to fetch wallet data for any division')
	}
}

/**
 * Handle wallet journal refresh
 * If division is specified, only fetch that division
 * Otherwise fetch all 7 divisions
 */
export async function handleWalletJournalRefresh(
	stub: EveCorporationData,
	message: WalletJournalRefreshMessage
): Promise<void> {
	if (message.division) {
		await stub.fetchFinancialData(message.corporationId, message.division)
	} else {
		// Fetch all 7 divisions in parallel
		const results = await Promise.allSettled(
			[1, 2, 3, 4, 5, 6, 7].map((div) => stub.fetchFinancialData(message.corporationId, div))
		)

		const succeeded = results.filter((r) => r.status === 'fulfilled')
		if (succeeded.length === 0) {
			throw new Error('Failed to fetch wallet journal for any division')
		}
	}
}

/**
 * Handle wallet transactions refresh
 * If division is specified, only fetch that division
 * Otherwise fetch all 7 divisions
 */
export async function handleWalletTransactionsRefresh(
	stub: EveCorporationData,
	message: WalletTransactionsRefreshMessage
): Promise<void> {
	if (message.division) {
		await stub.fetchFinancialData(message.corporationId, message.division)
	} else {
		// Fetch all 7 divisions in parallel
		const results = await Promise.allSettled(
			[1, 2, 3, 4, 5, 6, 7].map((div) => stub.fetchFinancialData(message.corporationId, div))
		)

		const succeeded = results.filter((r) => r.status === 'fulfilled')
		if (succeeded.length === 0) {
			throw new Error('Failed to fetch wallet transactions for any division')
		}
	}
}

/**
 * Handle assets refresh
 */
export async function handleAssetsRefresh(
	stub: EveCorporationData,
	message: AssetsRefreshMessage
): Promise<void> {
	await stub.fetchAssetsData(message.corporationId)
}

/**
 * Handle structures refresh
 */
export async function handleStructuresRefresh(
	stub: EveCorporationData,
	message: StructuresRefreshMessage
): Promise<void> {
	await stub.fetchAssetsData(message.corporationId)
}

/**
 * Handle market orders refresh
 */
export async function handleOrdersRefresh(
	stub: EveCorporationData,
	message: OrdersRefreshMessage
): Promise<void> {
	await stub.fetchMarketData(message.corporationId)
}

/**
 * Handle contracts refresh
 */
export async function handleContractsRefresh(
	stub: EveCorporationData,
	message: ContractsRefreshMessage
): Promise<void> {
	await stub.fetchMarketData(message.corporationId)
}

/**
 * Handle industry jobs refresh
 */
export async function handleIndustryJobsRefresh(
	stub: EveCorporationData,
	message: IndustryJobsRefreshMessage
): Promise<void> {
	await stub.fetchMarketData(message.corporationId)
}

/**
 * Handle killmails refresh
 */
export async function handleKillmailsRefresh(
	stub: EveCorporationData,
	message: KillmailsRefreshMessage
): Promise<void> {
	await stub.fetchKillmails(message.corporationId)
}
