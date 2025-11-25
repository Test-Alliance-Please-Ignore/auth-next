/**
 * User-facing Bills API client
 */

import type { BillStatus, BillWithDetails } from '@repo/bills'

const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8787/api'

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
export async function getMyBills(params?: { status?: BillStatus }): Promise<BillWithDetails[]> {
	const searchParams = new URLSearchParams()
	if (params?.status) searchParams.set('status', params.status)

	const query = searchParams.toString()
	return fetchJson(`${API_BASE_URL}/bills/my-bills${query ? `?${query}` : ''}`)
}

/**
 * Get a single bill by ID (only if user is the payer)
 */
export async function getBill(billId: string): Promise<BillWithDetails> {
	return fetchJson(`${API_BASE_URL}/bills/my-bills/${billId}`)
}
