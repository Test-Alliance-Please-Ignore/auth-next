import type { EveCorporationData } from '@repo/eve-corporation-data'
import type {
	PublicRefreshMessage,
	MembersRefreshMessage,
	MemberTrackingRefreshMessage,
	WalletsRefreshMessage,
	WalletJournalRefreshMessage,
	WalletTransactionsRefreshMessage,
	AssetsRefreshMessage,
	StructuresRefreshMessage,
	OrdersRefreshMessage,
	ContractsRefreshMessage,
	IndustryJobsRefreshMessage,
	KillmailsRefreshMessage,
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
	_message: MembersRefreshMessage
): Promise<void> {
	await stub.fetchCoreData()
}

/**
 * Handle member tracking refresh
 */
export async function handleMemberTrackingRefresh(
	stub: EveCorporationData,
	_message: MemberTrackingRefreshMessage
): Promise<void> {
	await stub.fetchCoreData()
}

/**
 * Handle wallets refresh (all 7 divisions)
 */
export async function handleWalletsRefresh(
	stub: EveCorporationData,
	_message: WalletsRefreshMessage
): Promise<void> {
	// Fetch wallet balances for all 7 divisions in parallel
	const results = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7].map((div) => stub.fetchFinancialData(div)))

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
		await stub.fetchFinancialData(message.division)
	} else {
		// Fetch all 7 divisions in parallel
		const results = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7].map((div) => stub.fetchFinancialData(div)))

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
		await stub.fetchFinancialData(message.division)
	} else {
		// Fetch all 7 divisions in parallel
		const results = await Promise.allSettled([1, 2, 3, 4, 5, 6, 7].map((div) => stub.fetchFinancialData(div)))

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
	_message: AssetsRefreshMessage
): Promise<void> {
	await stub.fetchAssetsData()
}

/**
 * Handle structures refresh
 */
export async function handleStructuresRefresh(
	stub: EveCorporationData,
	_message: StructuresRefreshMessage
): Promise<void> {
	await stub.fetchAssetsData()
}

/**
 * Handle market orders refresh
 */
export async function handleOrdersRefresh(
	stub: EveCorporationData,
	_message: OrdersRefreshMessage
): Promise<void> {
	await stub.fetchMarketData()
}

/**
 * Handle contracts refresh
 */
export async function handleContractsRefresh(
	stub: EveCorporationData,
	_message: ContractsRefreshMessage
): Promise<void> {
	await stub.fetchMarketData()
}

/**
 * Handle industry jobs refresh
 */
export async function handleIndustryJobsRefresh(
	stub: EveCorporationData,
	_message: IndustryJobsRefreshMessage
): Promise<void> {
	await stub.fetchMarketData()
}

/**
 * Handle killmails refresh
 */
export async function handleKillmailsRefresh(
	stub: EveCorporationData,
	_message: KillmailsRefreshMessage
): Promise<void> {
	await stub.fetchKillmails()
}
