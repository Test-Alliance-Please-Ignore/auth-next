/**
 * Main report component
 * Assembles all sections of the character report with tabbed layout
 */

import type { ProcessedPublicInfo } from '../../workflows/processors/helpers/public-info'
import type { ProcessedAssets } from '../../workflows/processors/helpers/assets'
import type { ProcessedWalletTransactions } from '../../workflows/processors/helpers/wallet-transactions'
import type { ProcessedWalletJournalEntries } from '../../workflows/processors/helpers/wallet-journal'
import type { EnrichedMailData } from '../../workflows/processors/helpers/mails'
import type { EnrichedNotificationData } from '../../workflows/processors/helpers/notifications'
import type { ProcessedContacts } from '../../workflows/processors/helpers/contacts'
import type { FittedShip } from '../../workflows/processors/helpers/ships'
import { PublicInfoSection } from './PublicInfoSection'
import { AssetsSection } from './AssetsSection'
import { FittedShipsSection } from './FittedShipsSection'
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
	// Debug logging
	if (typeof window !== 'undefined') {
		console.log('[Report] Received results:', {
			totalResults: results.length,
			resultTypes: results.map((r) => {
				if (!r) return 'null'
				if (Array.isArray(r)) {
					if (r.length === 0) return 'empty-array'
					const first = r[0]
					if (typeof first === 'object' && first !== null) {
						if ('shipName' in first) return 'fitted-ships-array'
						if ('type_id' in first && 'item_id' in first) return 'assets-array'
						if ('transaction_id' in first) return 'wallet-transactions-array'
						if ('ref_type' in first) return 'wallet-journal-array'
						if ('mail_id' in first) return 'mails-array'
						if ('contact_id' in first) return 'contacts-array'
					}
					return 'unknown-array'
				}
				if (typeof r === 'object' && 'characterName' in r) return 'public-info'
				if (typeof r === 'object' && 'mails' in r) return 'enriched-mail-data'
				return 'unknown'
			}),
		})
	}

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

	const mailData = results.find(
		(r): r is EnrichedMailData =>
			r !== null &&
			r !== undefined &&
			!Array.isArray(r) &&
			typeof r === 'object' &&
			'mails' in r &&
			Array.isArray((r as EnrichedMailData).mails),
	) as EnrichedMailData | undefined
	const mails = mailData?.mails

	const notificationData = results.find(
		(r): r is EnrichedNotificationData =>
			r !== null &&
			r !== undefined &&
			!Array.isArray(r) &&
			typeof r === 'object' &&
			'notifications' in r &&
			Array.isArray((r as EnrichedNotificationData).notifications),
	) as EnrichedNotificationData | undefined

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

	// Find fitted ships - check for array with FittedShip structure
	const fittedShips = results.find((r): r is FittedShip[] => {
		if (!r || !Array.isArray(r)) {
			if (typeof window !== 'undefined') {
				console.log('[Report] Fitted ships type guard: not array', { type: typeof r, isNull: r === null })
			}
			return false
		}
		// Empty array is valid
		if (r.length === 0) {
			if (typeof window !== 'undefined') {
				console.log('[Report] Fitted ships type guard: empty array matched')
			}
			return true
		}
		// Check first element has FittedShip structure
		const first = r[0]
		const matches =
			typeof first === 'object' &&
			first !== null &&
			'shipName' in first &&
			'shipTypeId' in first &&
			'locationId' in first &&
			'locationFlag' in first &&
			'locationType' in first &&
			Array.isArray(first.rigs) &&
			Array.isArray(first.highs) &&
			Array.isArray(first.meds) &&
			Array.isArray(first.lows)
		if (typeof window !== 'undefined') {
			console.log('[Report] Fitted ships type guard:', {
				matches,
				firstElement: first
					? {
						type: typeof first,
						hasShipName: 'shipName' in first,
						hasShipTypeId: 'shipTypeId' in first,
						hasLocationId: 'locationId' in first,
						hasLocationFlag: 'locationFlag' in first,
						hasLocationType: 'locationType' in first,
						rigsIsArray: Array.isArray(first.rigs),
						highsIsArray: Array.isArray(first.highs),
						medsIsArray: Array.isArray(first.meds),
						lowsIsArray: Array.isArray(first.lows),
						allKeys: Object.keys(first),
					}
					: null,
			})
		}
		return matches
	}) as FittedShip[] | undefined

	if (typeof window !== 'undefined') {
		console.log('[Report] Fitted ships extraction result:', {
			found: fittedShips !== undefined,
			isArray: Array.isArray(fittedShips),
			length: Array.isArray(fittedShips) ? fittedShips.length : 'N/A',
		})
	}

	// Build tabs array with available data
	// Contacts tab MUST be first
	const tabs = []

	if (typeof window !== 'undefined') {
		console.log('[Report] Building tabs array, available data:', {
			hasContacts: !!contacts,
			hasAssets: !!assets,
			hasFittedShips: fittedShips !== undefined,
			hasWalletTransactions: !!walletTransactions,
			hasWalletJournal: !!walletJournal,
			hasMails: !!mails,
		})
	}

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

	if (fittedShips !== undefined) {
		if (typeof window !== 'undefined') {
			console.log('[Report] Adding fitted ships tab:', {
				id: 'fitted-ships',
				label: 'Fit ships',
				count: fittedShips.length,
			})
		}
		tabs.push({
			id: 'fitted-ships',
			label: 'Fit ships',
			count: fittedShips.length,
			content: <FittedShipsSection data={fittedShips} />,
		})
	} else {
		if (typeof window !== 'undefined') {
			console.log('[Report] Fitted ships tab NOT added - fittedShips is undefined')
		}
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

	if (mails || (notificationData && notificationData.notifications.length > 0)) {
		const mailCount = mails?.length ?? 0
		const notifCount = notificationData?.notifications?.length ?? 0
		tabs.push({
			id: 'communications',
			label: 'Communications',
			count: mailCount + notifCount,
			content: (
				<div>
					{mails && mails.length > 0 && (
						<div>
							<h3 style={{ margin: '8px 0' }}>Mails ({mails.length})</h3>
							<MailList data={mails} />
						</div>
					)}
					{notificationData && notificationData.notifications.length > 0 && (
						<div>
							<h3 style={{ margin: '8px 0' }}>Notifications ({notificationData.notifications.length})</h3>
							{notificationData.notifications.map((n, i) => (
								<div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #333' }}>
									<strong>{n.type}</strong> — {n.senderName || 'Unknown'}
									<br />
									<small>{n.timestamp}</small>
								</div>
							))}
						</div>
					)}
				</div>
			),
		})
	}

	if (typeof window !== 'undefined') {
		console.log('[Report] Final tabs array:', tabs.map((t) => ({ id: t.id, label: t.label, count: t.count })))
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
