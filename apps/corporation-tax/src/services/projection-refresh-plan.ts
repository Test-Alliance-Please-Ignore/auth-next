import { isCheckpointCurrent } from './wallet-watermark'

import type { IngestTaxLedgerWindowInput, TaxLedgerIngestionHealth } from '@repo/corporation-tax'
import type { TriggerTaxProjectionRefreshInput } from '@repo/corporation-tax'

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

	const fromDateCandidates: Date[] = []
	if (!journalCurrent) {
		const checkpoint = checkpointBySource.get('corporation_wallet_journal')
		if (checkpoint?.lastSeenAt) {
			fromDateCandidates.push(new Date(checkpoint.lastSeenAt.getTime() - overlapWindowMs))
		}
	}
	if (!transactionsCurrent) {
		const checkpoint = checkpointBySource.get('corporation_wallet_transaction')
		if (checkpoint?.lastSeenAt) {
			fromDateCandidates.push(new Date(checkpoint.lastSeenAt.getTime() - overlapWindowMs))
		}
	}
	const fromDate =
		fromDateCandidates.length > 0
			? fromDateCandidates.reduce((earliest, current) => (current < earliest ? current : earliest))
			: undefined

	return {
		shouldTrigger: true,
		ingestInput: {
			includeJournal,
			includeTransactions,
			includeCharacterWallets: input.includeCharacterWallets ?? true,
			fromDate,
		},
	}
}
