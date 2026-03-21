import { isCheckpointCurrent } from './wallet-watermark'

import type {
	IngestTaxLedgerWindowInput,
	TaxLedgerIngestionHealth,
	TriggerTaxProjectionRefreshInput,
} from '@repo/corporation-tax'

export function planProjectionRefreshFromWalletSync(
	input: TriggerTaxProjectionRefreshInput,
	health: Pick<TaxLedgerIngestionHealth, 'checkpoints'>,
	overlapWindowMs: number
):
	| { shouldTrigger: false; reason: 'no_sources' | 'up_to_date' }
	| { shouldTrigger: true; ingestInput: IngestTaxLedgerWindowInput } {
	const includeJournal = Boolean(input.walletJournal)
	const includeTransactions = Boolean(input.walletTransactions)
	if (!includeJournal && !includeTransactions) {
		return {
			shouldTrigger: false,
			reason: 'no_sources',
		}
	}

	const checkpointBySource = new Map(
		health.checkpoints.map((checkpoint) => [checkpoint.sourceType, checkpoint])
	)
	const journalCurrent =
		!input.walletJournal ||
		isCheckpointCurrent(checkpointBySource.get('corporation_wallet_journal'), input.walletJournal)
	const transactionsCurrent =
		!input.walletTransactions ||
		isCheckpointCurrent(
			checkpointBySource.get('corporation_wallet_transaction'),
			input.walletTransactions
		)

	if (journalCurrent && transactionsCurrent) {
		return {
			shouldTrigger: false,
			reason: 'up_to_date',
		}
	}

	const PERIOD_BOUNDARY_ALLOWANCE_MS = 24 * 60 * 60 * 1000
	const currentMonthStart = new Date(
		Date.UTC(input.triggeredAt.getUTCFullYear(), input.triggeredAt.getUTCMonth(), 1, 0, 0, 0, 0)
	)
	const boundaryAllowanceStart = new Date(
		currentMonthStart.getTime() - PERIOD_BOUNDARY_ALLOWANCE_MS
	)
	const fromDateCandidates: Date[] = []
	const staleCheckpointSeenAt: Date[] = []
	if (!journalCurrent) {
		const checkpoint = checkpointBySource.get('corporation_wallet_journal')
		if (checkpoint?.lastSeenAt) {
			staleCheckpointSeenAt.push(checkpoint.lastSeenAt)
			fromDateCandidates.push(new Date(checkpoint.lastSeenAt.getTime() - overlapWindowMs))
		}
	}
	if (!transactionsCurrent) {
		const checkpoint = checkpointBySource.get('corporation_wallet_transaction')
		if (checkpoint?.lastSeenAt) {
			staleCheckpointSeenAt.push(checkpoint.lastSeenAt)
			fromDateCandidates.push(new Date(checkpoint.lastSeenAt.getTime() - overlapWindowMs))
		}
	}
	const overlapFromDate =
		fromDateCandidates.length > 0
			? fromDateCandidates.reduce((earliest, current) => (current < earliest ? current : earliest))
			: undefined
	const hasCheckpointOlderThanBoundaryAllowance = staleCheckpointSeenAt.some(
		(lastSeenAt) => lastSeenAt < boundaryAllowanceStart
	)
	const fromDate =
		overlapFromDate && !hasCheckpointOlderThanBoundaryAllowance
			? overlapFromDate
			: currentMonthStart

	return {
		shouldTrigger: true,
		ingestInput: {
			includeJournal,
			includeTransactions,
			// Static override: keep projection refresh ingest corporation-wallet only for now.
			includeCharacterWallets: false,
			fromDate,
		},
	}
}
