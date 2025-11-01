/**
 * Applications Feature Module
 *
 * Public exports for the HR job applications feature.
 * Provides API clients, React Query hooks, and UI components.
 */

// API Client and Types
export {
	applicationsApi,
	canReviewApplication,
	canWithdrawApplication,
	getSentimentDisplayName,
	getStatusDisplayName,
	type AddHRNoteRequest,
	type AddRecommendationRequest,
	type Application,
	type ApplicationActivityLogEntry,
	type ApplicationsParams,
	type ApplicationStatus,
	type HRNote,
	type HRNoteType,
	type HRNotePriority,
	type HRNotesParams,
	type Recommendation,
	type RecommendationSentiment,
	type SubmitApplicationRequest,
	type UpdateApplicationStatusRequest,
	type UpdateHRNoteRequest,
	type UpdateRecommendationRequest,
} from './api'

// React Query Hooks
export {
	applicationKeys,
	useAddHRNote,
	useAddRecommendation,
	useApplication,
	useApplicationActivity,
	useApplicationManager,
	useApplications,
	useDeleteHRNote,
	useDeleteRecommendation,
	useHRNote,
	useHRNotes,
	useRecommendations,
	useSubmitApplication,
	useUpdateApplicationStatus,
	useUpdateHRNote,
	useUpdateRecommendation,
	useWithdrawApplication,
} from './hooks'

// Components
export { AddHRNoteDialog } from './components/add-hr-note-dialog'
export { AddRecommendationDialog } from './components/add-recommendation-dialog'
export { ApplicationActionPanel } from './components/application-action-panel'
export { ApplicationCard } from './components/application-card'
export { ApplicationStatusBadge } from './components/application-status-badge'
export { ApplicationStatsCard } from './components/application-stats-card'
export { ApplicationsTable } from './components/applications-table'
export { ApplicationTimeline } from './components/application-timeline'
export { DeleteHRNoteDialog } from './components/delete-hr-note-dialog'
export { DeleteRecommendationDialog } from './components/delete-recommendation-dialog'
export { HRNoteCard } from './components/hr-note-card'
export { HRNoteTypeBadge } from './components/hr-note-type-badge'
export { HRNotePriorityBadge } from './components/hr-note-priority-badge'
export { HRNotesList } from './components/hr-notes-list'
export { RecommendationCard } from './components/recommendation-card'
export { RecommendationList } from './components/recommendation-list'
export { RecommendationSentimentBadge } from './components/recommendation-sentiment-badge'
export { SubmitApplicationDialog } from './components/submit-application-dialog'

// Routes (exported as default exports from route files, re-exported here for convenience)
export { default as ApplicationDetail } from './routes/application-detail'
export { default as HrApplicationReview } from './routes/hr-application-review'
export { default as HrApplicationsList } from './routes/hr-applications-list'
export { default as HrDashboard } from './routes/hr-dashboard'
export { default as MyApplicationsList } from './routes/my-applications-list'
export { default as UserHrNotes } from './routes/user-hr-notes'
