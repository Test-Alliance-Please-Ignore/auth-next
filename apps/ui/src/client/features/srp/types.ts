// Re-export types from @repo/srp package
export type {
	CommentVisibility,
	CreateCommentSchema,
	CreateSRPRequestSchema,
	EditCommentSchema,
	LossWithSRPStatus,
	MarkPaidSchema,
	MarkPartiallyPaidSchema,
	PaymentStatus,
	RejectRequestSchema,
	RequestStatus,
	SRPCommentResponse,
	SRPConfigResponse,
	SRPHistoryResponse,
	SRPRequestResponse,
	SRPStatsResponse,
	UpdateSRPConfigSchema,
} from '@repo/srp'

// Import types for use in local interfaces
import type { RequestStatus, SRPRequestResponse } from '@repo/srp'

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
