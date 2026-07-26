import type { RequestStatus } from './types'

export const srpKeys = {
	all: ['srp'] as const,

	// Losses
	losses: (params?: { limit?: number; offset?: number }) => [...srpKeys.all, 'losses', params] as const,
	lossRefreshStatus: () => [...srpKeys.losses(), 'refresh-status'] as const,

	// Requests
	requests: () => [...srpKeys.all, 'requests'] as const,
	allRequests: () => [...srpKeys.all, 'requests'] as const,
	myRequests: (params: { limit?: number; offset?: number; status?: RequestStatus }) =>
		[...srpKeys.requests(), 'my', params] as const,
	request: (id: string) => [...srpKeys.requests(), id] as const,
	requestsByStatus: (
		status: RequestStatus,
		params: {
			limit?: number
			offset?: number
			characterName?: string
			shipTypeName?: string
			solarSystemName?: string
			dateFrom?: string
			dateTo?: string
		}
	) =>
		[...srpKeys.requests(), 'by-status', status, params] as const,

	// Pending reviews
	pending: () => [...srpKeys.all, 'pending'] as const,
	pendingRequests: (params: { corporationId?: string; limit?: number; offset?: number }) =>
		[...srpKeys.pending(), 'requests', params] as const,

	// Payments
	payments: () => [...srpKeys.all, 'payments'] as const,
	pendingPayments: (params: { corporationId?: string; limit?: number; offset?: number }) =>
		[...srpKeys.payments(), 'pending', params] as const,
	pendingPayoutTotal: (params?: { corporationId?: string }) =>
		[...srpKeys.payments(), 'pending-total', params] as const,
	paymentAlerts: (params?: { includeAcknowledged?: boolean; limit?: number; offset?: number }) =>
		[...srpKeys.payments(), 'alerts', params] as const,
	walletHistory: (params?: {
		reason?: string
		recipientId?: string
		alertsOnly?: boolean
		dateFrom?: string
		dateTo?: string
		limit?: number
		offset?: number
	}) => [...srpKeys.payments(), 'wallet-history', params] as const,

	// Comments
	comments: (requestId: string, includeInternal: boolean) =>
		[...srpKeys.all, 'comments', requestId, includeInternal] as const,

	// Config
	config: () => [...srpKeys.all, 'config'] as const,
	discordGuilds: () => [...srpKeys.config(), 'discord-guilds'] as const,

	// Policies
	policies: () => [...srpKeys.all, 'policies'] as const,

	// Stats
	stats: (params?: { startDate?: string; endDate?: string; corporationId?: string }) =>
		[...srpKeys.all, 'stats', params] as const,

	// Doctrine conformity
	doctrineFittingsByShip: (shipTypeId: string) =>
		[...srpKeys.all, 'doctrine-fittings', shipTypeId] as const,
}
