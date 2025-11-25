/**
 * Industry Feature Types
 *
 * Re-export types from API client for consistency
 */

// Import enums for use in this file
import {
	IndustryEntityType,
	ServiceStatus,
	ServiceType,
} from '@/lib/api'

// Re-export enums as both values AND types
export {
	IndustryEntityType,
	ServiceStatus,
	ServiceType,
} from '@/lib/api'

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
	general_manufacturing: 'General Manufacturing',
	capital_ship_manufacturing: 'Capital Ship Manufacturing',
	supercapital_ship_manufacturing: 'Supercapital Manufacturing',
	research: 'Research',
	blueprint_copying: 'Blueprint Copying',
	invention: 'Invention',
	reaction: 'Reaction',
	hauling: 'Hauling',
	custom_hauling: 'Custom Hauling',
	buyback: 'Buyback',
	acquisition: 'Acquisition',
	bookmarks: 'Bookmarks',
	other_service: 'Other Service',
}

/**
 * Entity type display names for UI
 */
export const ENTITY_TYPE_LABELS: Record<IndustryEntityType, string> = {
	user: 'User',
	character: 'Character',
	corporation: 'Corporation',
	alliance: 'Alliance',
	service_provider: 'Service Provider',
}

/**
 * Service status display names for UI
 */
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
	active: 'Active',
	inactive: 'Inactive',
	closed: 'Closed',
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
