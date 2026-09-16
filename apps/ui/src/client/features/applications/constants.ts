import { i18n } from '@/i18n'

import type { ApplicationStatus, ReportSectionName } from './api'

/** Application statuses where the application is still being actively processed */
export const ACTIVE_APPLICATION_STATUSES: ApplicationStatus[] = ['pending', 'under_review']

/** Application statuses where private application data access should still be treated as open */
export const OPEN_APPLICATION_STATUSES: ApplicationStatus[] = [
	'pending',
	'under_review',
	'accepted',
]

// ============================================================================
// Fulcrum Report Section Metadata
// ============================================================================

export interface SectionTab {
	name: ReportSectionName
	label: string
}

export const SECTION_TABS: SectionTab[] = [
	{
		name: 'public-info',
		get label() {
			return i18n.t('hrpages.overview')
		},
	},
	{
		name: 'alerts',
		get label() {
			return i18n.t('hrpages.legacyData')
		},
	},
	{
		name: 'skills',
		get label() {
			return i18n.t('hrpages.skills')
		},
	},
	{
		name: 'assets',
		get label() {
			return i18n.t('hrpages.assets')
		},
	},
	{
		name: 'fitted-ships',
		get label() {
			return i18n.t('hrpages.ships')
		},
	},
	{
		name: 'orders',
		get label() {
			return i18n.t('hrpages.orders')
		},
	},
	{
		name: 'contracts',
		get label() {
			return i18n.t('hrpages.contracts')
		},
	},
	{
		name: 'wallet-transactions',
		get label() {
			return i18n.t('hrpages.transactions')
		},
	},
	{
		name: 'wallet-journal',
		get label() {
			return i18n.t('hrpages.journal')
		},
	},
	{
		name: 'mails',
		get label() {
			return i18n.t('hrpages.communications')
		},
	},
	{
		name: 'contacts',
		get label() {
			return i18n.t('hrpages.contacts')
		},
	},
]

/** All possible data sections a complete report would contain */
export const ALL_DATA_SECTIONS: ReportSectionName[] = [
	'public-info',
	'alerts',
	'skills',
	'assets',
	'fitted-ships',
	'orders',
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
	get 'public-info'() {
		return i18n.t('hrpages.publicInfo')
	},
	get alerts() {
		return i18n.t('hrpages.legacyData')
	},
	get skills() {
		return i18n.t('hrpages.skills')
	},
	get assets() {
		return i18n.t('hrpages.assets')
	},
	get 'fitted-ships'() {
		return i18n.t('hrpages.ships')
	},
	get orders() {
		return i18n.t('hrpages.orders')
	},
	get contracts() {
		return i18n.t('hrpages.contracts')
	},
	get 'wallet-transactions'() {
		return i18n.t('hrpages.transactions')
	},
	get 'wallet-journal'() {
		return i18n.t('hrpages.journal')
	},
	get mails() {
		return i18n.t('hrpages.mails')
	},
	get contacts() {
		return i18n.t('hrpages.contacts')
	},
	get notifications() {
		return i18n.t('hrpages.notifications')
	},
	get 'corp-history'() {
		return i18n.t('hrpages.corpHistory')
	},
	get clones() {
		return i18n.t('hrpages.clones')
	},
}
