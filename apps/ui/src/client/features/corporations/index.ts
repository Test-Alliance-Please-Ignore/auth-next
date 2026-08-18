/**
 * Corporations Feature
 *
 * Public exports for the Corporations feature module.
 * Components are lazy loaded separately, not exported here.
 */

// Re-export hooks for easy access
export * from './hooks'

// Re-export API types for use in other parts of the app
export type {
	CorporationAccessResult,
	CorporationCoverageResult,
	CorporationCoverageStats,
	CorporationMember,
	MyCorporation,
} from './api'

// Re-export helper functions
export {
	sortMembers,
	filterMembersByAuthStatus,
	filterMembersByActivity,
	getMemberStatistics,
} from './api'
