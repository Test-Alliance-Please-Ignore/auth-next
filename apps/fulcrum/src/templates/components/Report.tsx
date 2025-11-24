/**
 * Main report component
 * Assembles all sections of the character report with tabbed layout
 */

import type { ProcessedPublicInfo } from '../../workflows/processors/helpers/public-info'
import type { ProcessedAssets } from '../../workflows/processors/helpers/assets'
import type { ProcessedWalletTransactions } from '../../workflows/processors/helpers/wallet-transactions'
import type { ProcessedWalletJournalEntries } from '../../workflows/processors/helpers/wallet-journal'
import type { ProcessedMails } from '../../workflows/processors/helpers/mails'
import type { ProcessedContacts } from '../../workflows/processors/helpers/contacts'
import { PublicInfoSection } from './PublicInfoSection'
import { AssetsSection } from './AssetsSection'
import { WalletTransactionsSection } from './WalletTransactionsSection'
import { WalletJournalSection } from './WalletJournalSection'
import { MailList } from './MailList'
import { ContactsSection } from './ContactsSection'
import { ReportFooter } from './ReportFooter'
import { ReportHeader } from './ReportHeader'
import { TabbedContainer } from './TabbedContainer'

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

	const mails = results.find(
		(r): r is ProcessedMails =>
			r !== null &&
			r !== undefined &&
			Array.isArray(r) &&
			r.length > 0 &&
			typeof r[0] === 'object' &&
			r[0] !== null &&
			'mail_id' in r[0] &&
			('subject' in r[0] || 'from' in r[0]),
	) as ProcessedMails | undefined

	const contacts = results.find(
		(r): r is ProcessedContacts =>
			r !== null &&
			r !== undefined &&
			Array.isArray(r) &&
			r.length > 0 &&
			typeof r[0] === 'object' &&
			r[0] !== null &&
			'contact_id' in r[0] &&
			'contact_type' in r[0],
	) as ProcessedContacts | undefined

	// Build tabs array with available data
	// Contacts tab MUST be first
	const tabs = []

	if (contacts) {
		tabs.push({
			id: 'contacts',
			label: 'Contacts List',
			count: contacts.length,
			content: <ContactsSection data={contacts} />,
		})
	}

	if (assets) {
		tabs.push({
			id: 'assets',
			label: 'Assets',
			count: assets.length,
			content: <AssetsSection data={assets} />,
		})
	}

	if (walletTransactions) {
		tabs.push({
			id: 'transactions',
			label: 'Wallet Transactions',
			count: walletTransactions.length,
			content: <WalletTransactionsSection data={walletTransactions} />,
		})
	}

	if (walletJournal) {
		tabs.push({
			id: 'journal',
			label: 'Wallet Journal',
			count: walletJournal.length,
			content: <WalletJournalSection data={walletJournal} />,
		})
	}

	if (mails) {
		tabs.push({
			id: 'mails',
			label: 'Mail',
			count: mails.length,
			content: <MailList data={mails} />,
		})
	}

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

			{tabs.length > 0 && (
				<TabbedContainer
					tabs={tabs}
					defaultActiveTab={contacts ? 'contacts' : tabs[0]?.id || 'assets'}
				/>
			)}

			<ReportFooter />
		</div>
	)
}
