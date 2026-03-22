/**
 * User-facing Bills API client
 */

import type {
	BillListPage,
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	BillStatus,
	BillWithDetails,
	EntityType,
} from '@repo/bills'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
	const response = await fetch(url, {
		...options,
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			'X-Requested-With': 'XMLHttpRequest',
			...options?.headers,
		},
	})

	if (!response.ok) {
		const errorData = (await response.json().catch(() => ({}))) as { error?: string }
		throw new Error(errorData.error || `HTTP ${response.status}`)
	}

	return response.json()
}

/**
 * Get bills for the current user (where they are the payer)
 */
export async function getMyBills(params?: {
	status?: BillStatus
	payerId?: string
	payeeId?: string
	payerType?: EntityType
	payeeType?: EntityType
	issuerId?: string
	dueAfter?: string
	dueBefore?: string
	createdAfter?: string
	createdBefore?: string
	limit?: number
	offset?: number
	sortBy?: BillListSortField
	sortDir?: BillListSortDirection
}): Promise<BillListPage> {
	const searchParams = new URLSearchParams()
	if (params?.status) searchParams.set('status', params.status)
	if (params?.payerId) searchParams.set('payerId', params.payerId)
	if (params?.payeeId) searchParams.set('payeeId', params.payeeId)
	if (params?.payerType) searchParams.set('payerType', params.payerType)
	if (params?.payeeType) searchParams.set('payeeType', params.payeeType)
	if (params?.issuerId) searchParams.set('issuerId', params.issuerId)
	if (params?.dueAfter) searchParams.set('dueAfter', params.dueAfter)
	if (params?.dueBefore) searchParams.set('dueBefore', params.dueBefore)
	if (params?.createdAfter) searchParams.set('createdAfter', params.createdAfter)
	if (params?.createdBefore) searchParams.set('createdBefore', params.createdBefore)
	if (params?.limit) searchParams.set('limit', String(params.limit))
	if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))
	if (params?.sortBy) searchParams.set('sortBy', params.sortBy)
	if (params?.sortDir) searchParams.set('sortDir', params.sortDir)

	const query = searchParams.toString()
	return fetchJson(`${API_BASE_URL}/bills/my-bills${query ? `?${query}` : ''}`)
}

/**
 * Get a single bill by ID (only if user is the payer)
 */
export async function getBill(billId: string): Promise<BillWithDetails> {
	return fetchJson(`${API_BASE_URL}/bills/my-bills/${billId}`)
}

export interface BillPartySearchResult {
	entityId: string
	entityType: EntityType
	usageCount: number
	name: string | null
}

export async function searchMyBillParties(params: {
	q: string
	direction?: BillPartyDirection
	entityType?: EntityType
	limit?: number
}): Promise<BillPartySearchResult[]> {
	const searchParams = new URLSearchParams()
	searchParams.set('q', params.q)
	if (params.direction) searchParams.set('direction', params.direction)
	if (params.entityType) searchParams.set('entityType', params.entityType)
	if (params.limit) searchParams.set('limit', String(params.limit))
	return fetchJson(`${API_BASE_URL}/bills/my-bills/parties/search?${searchParams.toString()}`)
}
