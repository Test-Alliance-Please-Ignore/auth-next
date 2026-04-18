import type { RequestStatus } from './types'

export const srpKeys = {
	all: ['srp'] as const,

	// Losses
	losses: (daysBack?: number) => [...srpKeys.all, 'losses', daysBack] as const,

	// Requests
	requests: () => [...srpKeys.all, 'requests'] as const,
	allRequests: () => [...srpKeys.all, 'requests'] as const,
	myRequests: (params: { limit?: number; offset?: number; status?: RequestStatus }) =>
		[...srpKeys.requests(), 'my', params] as const,
	request: (id: string) => [...srpKeys.requests(), id] as const,
	requestsByStatus: (status: RequestStatus, params: { limit?: number; offset?: number }) =>
		[...srpKeys.requests(), 'by-status', status, params] as const,

	// Pending reviews
	pending: () => [...srpKeys.all, 'pending'] as const,
	pendingRequests: (params: { corporationId?: string; limit?: number; offset?: number }) =>
		[...srpKeys.pending(), 'requests', params] as const,

	// Payments
	payments: () => [...srpKeys.all, 'payments'] as const,
	pendingPayments: (params: { corporationId?: string; limit?: number; offset?: number }) =>
		[...srpKeys.payments(), 'pending', params] as const,

	// Comments
	comments: (requestId: string, includeInternal: boolean) =>
		[...srpKeys.all, 'comments', requestId, includeInternal] as const,

	// Config
	config: () => [...srpKeys.all, 'config'] as const,

	// Policies
	policies: () => [...srpKeys.all, 'policies'] as const,

	// Stats
	stats: (params?: { startDate?: string; endDate?: string; corporationId?: string }) =>
		[...srpKeys.all, 'stats', params] as const,
}
