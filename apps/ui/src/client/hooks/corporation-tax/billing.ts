import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import { corporationTaxKeys } from './keys'

export function useTaxCorporationBillHistory(
	corporationId: string | undefined,
	filters?: {
		limit?: number
		offset?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.billHistory(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getCorporationBillHistory(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxCorporationBillEventHistory(
	corporationId: string | undefined,
	filters?: {
		limit?: number
		offset?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.billEventHistory(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getCorporationBillEventHistory(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxBillingConfigs(corporationId: string | undefined, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.billingConfigs(corporationId ?? 'none'),
		queryFn: () => corporationTaxApi.listBillingConfigs(corporationId!),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && enabled,
	})
}

export function useSearchTaxBillingPayeeCorporations(
	corporationId: string | undefined,
	query: string,
	enabled = true
) {
	const trimmedQuery = query.trim()
	return useQuery({
		queryKey: corporationTaxKeys.billingPayeeCorporationSearch(
			corporationId ?? 'none',
			trimmedQuery
		),
		queryFn: () => corporationTaxApi.searchActivePayeeCorporations(corporationId!, trimmedQuery),
		staleTime: 1000 * 60 * 5,
		enabled: Boolean(corporationId) && enabled && trimmedQuery.length >= 2,
	})
}

export function useSearchTaxBillingPayeeCharacters(
	corporationId: string | undefined,
	query: string,
	enabled = true
) {
	const trimmedQuery = query.trim()
	return useQuery({
		queryKey: corporationTaxKeys.billingPayeeCharacterSearch(corporationId ?? 'none', trimmedQuery),
		queryFn: () => corporationTaxApi.searchPayeeCharacters(corporationId!, trimmedQuery),
		staleTime: 1000 * 60 * 5,
		enabled: Boolean(corporationId) && enabled && trimmedQuery.length >= 2,
	})
}

export function useTaxAssessments(
	corporationId: string | undefined,
	filters?: {
		status?: 'draft' | 'underpaid' | 'paid' | 'overpaid' | 'excluded'
		assessmentScope?: 'corporation' | 'division' | 'character'
		withBillOnly?: boolean
		limit?: number
		offset?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.assessments(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.listAssessments(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxLedgerEntries(
	corporationId: string | undefined,
	filters?: {
		division?: number
		sourceTypes?: Array<
			| 'corporation_wallet_journal'
			| 'corporation_wallet_transaction'
			| 'character_wallet_journal'
			| 'character_wallet_transaction'
		>
		characterId?: string
		refTypes?: string[]
		firstPartyId?: string
		secondPartyId?: string
		fromDate?: string
		toDate?: string
		minAmount?: string
		maxAmount?: string
		limit?: number
		offset?: number
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.ledgerEntries(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getLedgerEntries(corporationId!, filters),
		staleTime: 1000 * 30,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useTaxLedgerParties(
	corporationId: string | undefined,
	filters?: {
		fromDate?: string
		toDate?: string
		limit?: number
		q?: string
		direction?: 'any' | 'sender' | 'recipient'
		enabled?: boolean
	}
) {
	return useQuery({
		queryKey: corporationTaxKeys.ledgerParties(corporationId ?? 'none', filters),
		queryFn: () => corporationTaxApi.getLedgerParties(corporationId!, filters),
		staleTime: 1000 * 60 * 15,
		enabled: Boolean(corporationId) && (filters?.enabled ?? true),
	})
}

export function useCreateTaxBillForAssessment() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; assessmentId: string }) =>
			corporationTaxApi.createBillForAssessment(input.corporationId, input.assessmentId),
		onSuccess: (updated) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billEventHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(updated.corporationId),
			})
		},
	})
}

export function useSyncTaxAssessmentBillStatus() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; assessmentId: string }) =>
			corporationTaxApi.syncAssessmentBillStatus(input.corporationId, input.assessmentId),
		onSuccess: (updated) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billEventHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(updated.corporationId),
			})
		},
	})
}

export function useRetractTaxAssessmentBill() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; assessmentId: string }) =>
			corporationTaxApi.retractAssessmentBill(input.corporationId, input.assessmentId),
		onSuccess: (updated) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billEventHistory(updated.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(updated.corporationId),
			})
		},
	})
}

export function useIssueTaxBillsForPeriod() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; periodStart: string; periodEnd: string }) =>
			corporationTaxApi.issueBillsForPeriod(input.corporationId, {
				periodStart: input.periodStart,
				periodEnd: input.periodEnd,
			}),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(variables.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billEventHistory(variables.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(variables.corporationId),
			})
		},
	})
}

export function useSyncTaxCorporationBillStatuses() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; limit?: number }) =>
			corporationTaxApi.syncCorporationBillStatuses(input.corporationId, input.limit),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billStatus(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billHistory(variables.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billEventHistory(variables.corporationId),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.assessments(variables.corporationId),
			})
		},
	})
}

export function useCreateTaxBillingConfig() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			corporationId: string
			config: {
				isDefault?: boolean
				billingEnabled?: boolean
				billingIssuerUserId?: string
				billingPayeeId?: string
				billingPayeeType?: 'character' | 'corporation'
				billingDueDays?: number
			}
		}) => corporationTaxApi.createBillingConfig(input.corporationId, input.config),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billingConfigs(variables.corporationId),
			})
		},
	})
}

export function useUpdateTaxBillingConfig() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			corporationId: string
			configId: string
			updates: {
				isDefault?: boolean
				billingEnabled?: boolean
				billingIssuerUserId?: string
				billingPayeeId?: string
				billingPayeeType?: 'character' | 'corporation'
				billingDueDays?: number
			}
		}) => corporationTaxApi.updateBillingConfig(input.corporationId, input.configId, input.updates),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billingConfigs(variables.corporationId),
			})
		},
	})
}

export function useDeleteTaxBillingConfig() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; configId: string }) =>
			corporationTaxApi.deleteBillingConfig(input.corporationId, input.configId),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billingConfigs(variables.corporationId),
			})
		},
	})
}

export function useSetDefaultTaxBillingConfig() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; configId: string }) =>
			corporationTaxApi.setDefaultBillingConfig(input.corporationId, input.configId),
		onSuccess: (_result, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.billingConfigs(variables.corporationId),
			})
		},
	})
}
