// Import types for use in local interfaces
import type { RequestStatus, SRPRequestResponse } from '@repo/srp'

// Re-export types from @repo/srp package
export type {
	AppliedModifier,
	CommentVisibility,
	CreateSRPPolicy,
	LossWithSRPStatus,
	RequestStatus,
	SRPCommentResponse,
	SRPConfigResponse,
	SRPHistoryResponse,
	SRPPolicy,
	SRPRequestResponse,
	SRPReviewSubmission,
	SRPStatsResponse,
	UpdateSRPConfig,
} from '@repo/srp'

// UI-specific types
export interface PaginationParams {
	limit?: number
	offset?: number
}

export interface RequestFilters extends PaginationParams {
	status?: RequestStatus
	corporationId?: string
}

export interface RequestListResponse {
	requests: SRPRequestResponse[]
	total: number
	limit: number
	offset: number
}
