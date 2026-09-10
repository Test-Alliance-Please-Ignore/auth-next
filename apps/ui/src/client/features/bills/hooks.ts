import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
	cancelIssuedBill,
	deleteIssuedBill,
	getBill,
	getMyBills,
	issueIssuedBill,
	markIssuedBillPaid,
	revertIssuedBillToDraft,
	searchMyBillParties,
} from './api'
import { userBillsKeys } from './query-keys'

import type {
	BillListSortDirection,
	BillListSortField,
	BillPartyDirection,
	BillStatus,
	EntityType,
} from '@repo/bills'

/**
 * Get bills for the current user (where they are the payer)
 */
export function useMyBills(params?: {
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
}) {
	return useQuery({
		queryKey: userBillsKeys.list(params),
		queryFn: () => getMyBills(params),
		staleTime: 1000 * 60 * 10, // 10 minutes (matches backend cache TTL)
	})
}

/**
 * Get a single bill by ID from the user's authorized bill scope.
 */
export function useBill(billId: string) {
	return useQuery({
		queryKey: userBillsKeys.detail(billId),
		queryFn: () => getBill(billId),
		enabled: !!billId,
		staleTime: 1000 * 60 * 2, // 2 minutes
	})
}

function useIssuedBillMutation<T>(mutationFn: (billId: string) => Promise<T>) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn,
		onSuccess: (_result, billId) => {
			void queryClient.invalidateQueries({ queryKey: userBillsKeys.all })
			void queryClient.invalidateQueries({ queryKey: userBillsKeys.detail(billId) })
		},
	})
}

export function useIssueIssuedBill() {
	return useIssuedBillMutation(issueIssuedBill)
}

export function useCancelIssuedBill() {
	return useIssuedBillMutation(cancelIssuedBill)
}

export function useMarkIssuedBillPaid() {
	return useIssuedBillMutation(markIssuedBillPaid)
}

export function useRevertIssuedBillToDraft() {
	return useIssuedBillMutation(revertIssuedBillToDraft)
}

export function useDeleteIssuedBill() {
	return useIssuedBillMutation(deleteIssuedBill)
}

export function useMyBillPartySearch(params: {
	q: string
	direction?: BillPartyDirection
	entityType?: EntityType
	limit?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: userBillsKeys.partySearch(params),
		queryFn: () =>
			searchMyBillParties({
				q: params.q,
				direction: params.direction,
				entityType: params.entityType,
				limit: params.limit,
			}),
		enabled: params.enabled ?? params.q.trim().length >= 2,
		staleTime: 1000 * 60 * 2,
	})
}
