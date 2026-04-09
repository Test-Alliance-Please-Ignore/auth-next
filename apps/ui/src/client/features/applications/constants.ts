import type { ApplicationStatus, ReportSectionName } from './api'

/** Application statuses where the application is still being actively processed */
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = ['pending', 'under_review']

// ============================================================================
// Fulcrum Report Section Metadata
// ============================================================================

export interface SectionTab {
	name: ReportSectionName
	label: string
}

export const SECTION_TABS: SectionTab[] = [
	{ name: 'public-info', label: 'Overview' },
	{ name: 'skills', label: 'Skills' },
	{ name: 'assets', label: 'Assets' },
	{ name: 'fitted-ships', label: 'Ships' },
	{ name: 'contracts', label: 'Contracts' },
	{ name: 'wallet-transactions', label: 'Transactions' },
	{ name: 'wallet-journal', label: 'Journal' },
	{ name: 'mails', label: 'Communications' },
	{ name: 'contacts', label: 'Contacts' },
]

/** All possible data sections a complete report would contain */
export const ALL_DATA_SECTIONS: ReportSectionName[] = [
	'public-info',
	'skills',
	'assets',
	'fitted-ships',
	'contracts',
	'wallet-transactions',
	'wallet-journal',
	'mails',
	'contacts',
	'notifications',
	'corp-history',
	'clones',
]

export const SECTION_LABELS: Record<string, string> = {
	'public-info': 'Public Info',
	skills: 'Skills',
	assets: 'Assets',
	'fitted-ships': 'Ships',
	contracts: 'Contracts',
	'wallet-transactions': 'Transactions',
	'wallet-journal': 'Journal',
	mails: 'Mails',
	contacts: 'Contacts',
	notifications: 'Notifications',
	'corp-history': 'Corp History',
	clones: 'Clones',
}
