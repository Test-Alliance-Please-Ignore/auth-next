/**
 * My Corporations Feature
 *
 * Public exports for the My Corporations feature module.
 * Components are lazy loaded separately, not exported here.
 */

// Re-export hooks for easy access
export * from './hooks'

// Explicitly export the quick access hook for the sidebar
export { useHasCorporationAccess } from './hooks'

// Re-export API types for use in other parts of the app
export type { CorporationMember, MyCorporation, CorporationAccessResult } from './api'

// Re-export helper functions
export {
	sortMembers,
	filterMembersByAuthStatus,
	filterMembersByActivity,
	getMemberStatistics,
} from './api'