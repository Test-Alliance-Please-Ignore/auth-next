import { useQuery } from '@tanstack/react-query'

import { getBill, getMyBills } from './api'
import { userBillsKeys } from './query-keys'

import type { BillStatus } from '@repo/bills'

/**
 * Get bills for the current user (where they are the payer)
 */
export function useMyBills(params?: { status?: BillStatus }) {
	return useQuery({
		queryKey: userBillsKeys.list(params),
		queryFn: () => getMyBills(params),
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

/**
 * Get a single bill by ID (only if user is the payer)
 */
export function useBill(billId: string) {
	return useQuery({
		queryKey: userBillsKeys.detail(billId),
		queryFn: () => getBill(billId),
		enabled: !!billId,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}
