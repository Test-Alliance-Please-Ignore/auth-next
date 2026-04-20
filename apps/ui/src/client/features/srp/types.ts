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
	SRPPaymentMismatchAlert,
	SRPPredefinedAdhocModifier,
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

export type SRPRequestWithKillmailItemNames = SRPRequestResponse & {
	killmailItemNames?: Record<string, string>
}

export type DoctrineSlot = 'high' | 'mid' | 'low' | 'rig' | 'sub'
export type MilitarySrpFindingCode =
	| 'missing_rigs'
	| 'module_missing'
	| 'module_variant_mismatch'

export interface MilitarySrpFinding {
	code: MilitarySrpFindingCode
	slot?: DoctrineSlot
	message: string
	suggestedPenaltyPercent?: number
	doctrineTypeId?: string
	doctrineTypeName?: string
	actualTypeId?: string
	actualTypeName?: string
	groupName?: string
	quantity?: number
}

export interface MilitarySrpAssessment {
	isMilitary: boolean
	doctrineFittingId?: string
	doctrineFittingName?: string
	doctrineCategory?: string
	hasConformityIssues: boolean
	suggestedPenaltyPercent: number
	findings: MilitarySrpFinding[]
}

export type SRPRequestWithMilitary = SRPRequestResponse & {
	militarySrp?: MilitarySrpAssessment
}
