import { createCorporationQueueConsumer } from './consumer-factory'
import * as handlers from './handlers'
import * as schemas from './schemas'

/**
 * Queue consumer for public corporation info refreshes
 */
export const publicRefreshQueue = createCorporationQueueConsumer(
	'corp-public-refresh',
	schemas.publicRefreshMessageSchema,
	handlers.handlePublicRefresh
)

/**
 * Queue consumer for members roster refreshes
 */
export const membersRefreshQueue = createCorporationQueueConsumer(
	'corp-members-refresh',
	schemas.membersRefreshMessageSchema,
	handlers.handleMembersRefresh
)

/**
 * Queue consumer for member tracking refreshes
 */
export const memberTrackingRefreshQueue = createCorporationQueueConsumer(
	'corp-member-tracking-refresh',
	schemas.memberTrackingRefreshMessageSchema,
	handlers.handleMemberTrackingRefresh
)

/**
 * Queue consumer for wallet balance refreshes
 */
export const walletsRefreshQueue = createCorporationQueueConsumer(
	'corp-wallets-refresh',
	schemas.walletsRefreshMessageSchema,
	handlers.handleWalletsRefresh
)

/**
 * Queue consumer for wallet journal refreshes
 */
export const walletJournalRefreshQueue = createCorporationQueueConsumer(
	'corp-wallet-journal-refresh',
	schemas.walletJournalRefreshMessageSchema,
	handlers.handleWalletJournalRefresh
)

/**
 * Queue consumer for wallet transaction refreshes
 */
export const walletTransactionsRefreshQueue = createCorporationQueueConsumer(
	'corp-wallet-transactions-refresh',
	schemas.walletTransactionsRefreshMessageSchema,
	handlers.handleWalletTransactionsRefresh
)

/**
 * Queue consumer for assets refreshes
 */
export const assetsRefreshQueue = createCorporationQueueConsumer(
	'corp-assets-refresh',
	schemas.assetsRefreshMessageSchema,
	handlers.handleAssetsRefresh
)

/**
 * Queue consumer for structures refreshes
 */
export const structuresRefreshQueue = createCorporationQueueConsumer(
	'corp-structures-refresh',
	schemas.structuresRefreshMessageSchema,
	handlers.handleStructuresRefresh
)

/**
 * Queue consumer for market orders refreshes
 */
export const ordersRefreshQueue = createCorporationQueueConsumer(
	'corp-orders-refresh',
	schemas.ordersRefreshMessageSchema,
	handlers.handleOrdersRefresh
)

/**
 * Queue consumer for contracts refreshes
 */
export const contractsRefreshQueue = createCorporationQueueConsumer(
	'corp-contracts-refresh',
	schemas.contractsRefreshMessageSchema,
	handlers.handleContractsRefresh
)

/**
 * Queue consumer for industry jobs refreshes
 */
export const industryJobsRefreshQueue = createCorporationQueueConsumer(
	'corp-industry-jobs-refresh',
	schemas.industryJobsRefreshMessageSchema,
	handlers.handleIndustryJobsRefresh
)

/**
 * Queue consumer for killmails refreshes
 */
export const killmailsRefreshQueue = createCorporationQueueConsumer(
	'corp-killmails-refresh',
	schemas.killmailsRefreshMessageSchema,
	handlers.handleKillmailsRefresh
)
