import { i18n } from '@/i18n'
/**
 * Industry Feature Types
 *
 * Re-export types from API client for consistency
 */

// Import enums for use in this file
import { ServiceType } from '@/lib/api'

import type { IndustryEntityType, ServiceStatus } from '@/lib/api'

// Re-export enums as both values AND types
export { IndustryEntityType, ServiceStatus, ServiceType } from '@/lib/api'

// Re-export types
export type {
	CreateIndustryProviderRequest,
	IndustryProviderFilters,
	IndustryProviderStatistics,
	ProviderServiceDTO,
	ServiceProvider,
	UpdateIndustryProviderRequest,
} from '@/lib/api'

/**
 * Service type display names for UI
 */
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
	get general_manufacturing() {
		return i18n.t('industry.generalManufacturing')
	},
	get capital_ship_manufacturing() {
		return i18n.t('industry.capitalShipManufacturing')
	},
	get supercapital_ship_manufacturing() {
		return i18n.t('industry.supercapitalManufacturing')
	},
	get research() {
		return i18n.t('industry.research')
	},
	get blueprint_copying() {
		return i18n.t('industry.blueprintCopying')
	},
	get invention() {
		return i18n.t('industry.invention')
	},
	get reaction() {
		return i18n.t('industry.reaction')
	},
	get hauling() {
		return i18n.t('industry.hauling')
	},
	get custom_hauling() {
		return i18n.t('industry.customHauling')
	},
	get buyback() {
		return i18n.t('industry.buyback')
	},
	get acquisition() {
		return i18n.t('industry.acquisition')
	},
	get bookmarks() {
		return i18n.t('industry.bookmarks')
	},
	get other_service() {
		return i18n.t('industry.otherService')
	},
}

/**
 * Entity type display names for UI
 */
export const ENTITY_TYPE_LABELS: Record<IndustryEntityType, string> = {
	get user() {
		return i18n.t('industry.user')
	},
	get character() {
		return i18n.t('industry.character')
	},
	get corporation() {
		return i18n.t('industry.corporation')
	},
	get alliance() {
		return i18n.t('industry.alliance')
	},
	get service_provider() {
		return i18n.t('industry.serviceProvider')
	},
}

/**
 * Service status display names for UI
 */
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
	get active() {
		return i18n.t('industry.active')
	},
	get inactive() {
		return i18n.t('industry.inactive')
	},
	get closed() {
		return i18n.t('industry.closed')
	},
}

/**
 * Service types grouped by category for the wizard
 */
export const SERVICE_TYPE_CATEGORIES = {
	Manufacturing: [
		ServiceType.GENERAL_MANUFACTURING,
		ServiceType.CAPITAL_SHIP_MANUFACTURING,
		ServiceType.SUPERCAPITAL_SHIP_MANUFACTURING,
	],
	'Research & Development': [
		ServiceType.RESEARCHING,
		ServiceType.BLUEPRINT_COPYING,
		ServiceType.INVENTION,
		ServiceType.REACTION,
	],
	Logistics: [ServiceType.HAULING, ServiceType.CUSTOM_HAULING],
	Trade: [ServiceType.BUYBACK, ServiceType.ACQUISITION],
	Other: [ServiceType.BOOKMARKS, ServiceType.OTHER_SERVICE],
} as const
