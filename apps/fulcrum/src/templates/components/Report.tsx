/**
 * Main report component
 * Assembles all sections of the character report
 */

import type { ProcessedPublicInfo } from '../../workflows/processors/helpers/public-info'
import type { ProcessedAssets } from '../../workflows/processors/helpers/assets'
import type { ProcessedWalletTransactions } from '../../workflows/processors/helpers/wallet-transactions'
import type { ProcessedWalletJournalEntries } from '../../workflows/processors/helpers/wallet-journal'
import { PublicInfoSection } from './PublicInfoSection'
import { AssetsSection } from './AssetsSection'
import { WalletTransactionsSection } from './WalletTransactionsSection'
import { WalletJournalSection } from './WalletJournalSection'
import { ReportFooter } from './ReportFooter'
import { ReportHeader } from './ReportHeader'

interface ReportProps {
	results: unknown[]
}

export function Report({ results }: ReportProps) {
	// Extract data by type
	const publicInfo = results.find(
		(r): r is ProcessedPublicInfo =>
			r !== null &&
			r !== undefined &&
			typeof r === 'object' &&
			'characterName' in r &&
			'characterId' in r,
	) as ProcessedPublicInfo | undefined

	const assets = results.find(
		(r): r is ProcessedAssets =>
			r !== null &&
			r !== undefined &&
			Array.isArray(r) &&
			r.length > 0 &&
			typeof r[0] === 'object' &&
			r[0] !== null &&
			'type_id' in r[0] &&
			'item_id' in r[0],
	) as ProcessedAssets | undefined

	const walletTransactions = results.find(
		(r): r is ProcessedWalletTransactions =>
			r !== null &&
			r !== undefined &&
			Array.isArray(r) &&
			r.length > 0 &&
			typeof r[0] === 'object' &&
			r[0] !== null &&
			'transaction_id' in r[0] &&
			'type_id' in r[0] &&
			'is_buy' in r[0],
	) as ProcessedWalletTransactions | undefined

	const walletJournal = results.find(
		(r): r is ProcessedWalletJournalEntries =>
			r !== null &&
			r !== undefined &&
			Array.isArray(r) &&
			r.length > 0 &&
			typeof r[0] === 'object' &&
			r[0] !== null &&
			'ref_type' in r[0] &&
			'amount' in r[0] &&
			'id' in r[0],
	) as ProcessedWalletJournalEntries | undefined

	return (
		<div className="container">
			<ReportHeader
				characterName={publicInfo?.characterName}
				characterId={publicInfo?.characterId}
				generatedAt={new Date().toISOString()}
			/>

			{publicInfo ? (
				<PublicInfoSection data={publicInfo} />
			) : (
				<section>
					<p>No data available for this character.</p>
				</section>
			)}

			{assets && <AssetsSection data={assets} />}

			{walletTransactions && <WalletTransactionsSection data={walletTransactions} />}

			{walletJournal && <WalletJournalSection data={walletJournal} />}

			<ReportFooter />
		</div>
	)
}
