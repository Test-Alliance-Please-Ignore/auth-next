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
	await stub.fetchPublicData()
}

/**
 * Handle members roster refresh
 */
export async function handleMembersRefresh(
	stub: EveCorporationData,
	message: MembersRefreshMessage
): Promise<void> {
	const result = await stub.fetchCoreData()
	if (!result.members) {
		throw new Error('Failed to fetch members data')
	}
}

/**
 * Handle member tracking refresh
 */
export async function handleMemberTrackingRefresh(
	stub: EveCorporationData,
	message: MemberTrackingRefreshMessage
): Promise<void> {
	const result = await stub.fetchCoreData()
	if (!result.memberTracking) {
		throw new Error('Failed to fetch member tracking data')
	}
}

/**
 * Handle wallets refresh (all 7 divisions)
 */
export async function handleWalletsRefresh(
	stub: EveCorporationData,
	message: WalletsRefreshMessage
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
		const result = await stub.fetchFinancialData(message.division)
		if (!result.journal) {
			throw new Error(`Failed to fetch wallet journal for division ${message.division}`)
		}
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
		const result = await stub.fetchFinancialData(message.division)
		if (!result.transactions) {
			throw new Error(`Failed to fetch wallet transactions for division ${message.division}`)
		}
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
	message: AssetsRefreshMessage
): Promise<void> {
	const result = await stub.fetchAssetsData()
	if (!result.assets) {
		throw new Error('Failed to fetch assets data')
	}
}

/**
 * Handle structures refresh
 */
export async function handleStructuresRefresh(
	stub: EveCorporationData,
	message: StructuresRefreshMessage
): Promise<void> {
	const result = await stub.fetchAssetsData()
	if (!result.structures) {
		throw new Error('Failed to fetch structures data')
	}
}

/**
 * Handle market orders refresh
 */
export async function handleOrdersRefresh(
	stub: EveCorporationData,
	message: OrdersRefreshMessage
): Promise<void> {
	const result = await stub.fetchMarketData()
	if (!result.orders) {
		throw new Error('Failed to fetch orders data')
	}
}

/**
 * Handle contracts refresh
 */
export async function handleContractsRefresh(
	stub: EveCorporationData,
	message: ContractsRefreshMessage
): Promise<void> {
	const result = await stub.fetchMarketData()
	if (!result.contracts) {
		throw new Error('Failed to fetch contracts data')
	}
}

/**
 * Handle industry jobs refresh
 */
export async function handleIndustryJobsRefresh(
	stub: EveCorporationData,
	message: IndustryJobsRefreshMessage
): Promise<void> {
	const result = await stub.fetchMarketData()
	if (!result.industryJobs) {
		throw new Error('Failed to fetch industry jobs data')
	}
}

/**
 * Handle killmails refresh
 */
export async function handleKillmailsRefresh(
	stub: EveCorporationData,
	message: KillmailsRefreshMessage
): Promise<void> {
	const result = await stub.fetchKillmails()
	if (!result) {
		throw new Error('Failed to fetch killmails data')
	}
}
