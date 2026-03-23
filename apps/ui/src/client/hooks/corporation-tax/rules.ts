import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { corporationTaxApi } from '@/lib/tax-api'

import { corporationTaxKeys } from './keys'

export function useTaxRuleSets(filters?: {
	corporationId?: string
	ruleGroupId?: string
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	const hasFilter = Boolean(filters?.corporationId || filters?.ruleGroupId)
	return useQuery({
		queryKey: corporationTaxKeys.rules(filters),
		queryFn: () => corporationTaxApi.listRuleSets(filters),
		staleTime: 1000 * 30,
		enabled: hasFilter && (filters?.enabled ?? true),
	})
}

export function useCreateTaxRuleSet() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			corporationId?: string
			ruleSet: {
				name: string
				ruleGroupId: string
				priority?: number
				isActive?: boolean
				appliesToRefType?: string
				taxRateBps: number
			}
		}) => corporationTaxApi.createRuleSet(input.corporationId, input.ruleSet),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: [...corporationTaxKeys.all, 'rules'],
			})
		},
	})
}

export function useUpdateTaxRuleSet() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			ruleSetId: string
			updates: {
				isActive?: boolean
				name?: string
				priority?: number
				appliesToRefType?: string | null
				taxRateBps?: number
			}
		}) => corporationTaxApi.updateRuleSet(input.ruleSetId, input.updates),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useDeleteTaxRuleSet() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (ruleSetId: string) => corporationTaxApi.deleteRuleSet(ruleSetId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useTaxRuleGroups(filters?: {
	corporationId?: string
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	return useQuery({
		queryKey: corporationTaxKeys.ruleGroups(filters),
		queryFn: () => corporationTaxApi.listRuleGroups(filters),
		staleTime: 1000 * 30,
		enabled: filters?.enabled ?? true,
	})
}

export function useCreateTaxRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { name: string; description?: string | null }) =>
			corporationTaxApi.createRuleGroup(input),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
		},
	})
}

export function useUpdateTaxRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: {
			ruleGroupId: string
			updates: { name?: string; description?: string | null }
		}) => corporationTaxApi.updateRuleGroup(input.ruleGroupId, input.updates),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
		},
	})
}

export function useDeleteTaxRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (ruleGroupId: string) => corporationTaxApi.deleteRuleGroup(ruleGroupId),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}

export function useTaxRuleGroupAttachments(ruleGroupId: string | undefined, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.ruleGroupAttachments(ruleGroupId ?? 'none'),
		queryFn: () => corporationTaxApi.listRuleGroupAttachments(ruleGroupId!),
		staleTime: 1000 * 30,
		enabled: Boolean(ruleGroupId) && enabled,
	})
}

export function useAttachCorporationToRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { ruleGroupId: string; corporationId: string }) =>
			corporationTaxApi.attachCorporationToRuleGroup(input.ruleGroupId, input.corporationId),
		onMutate: async (variables) => {
			const queryKey = corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId)
			await queryClient.cancelQueries({ queryKey })
			const previous =
				queryClient.getQueryData<Array<{ id: string; ruleGroupId: string; corporationId: string }>>(
					queryKey
				) ?? []

			const exists = previous.some((row) => row.corporationId === variables.corporationId)
			if (!exists) {
				queryClient.setQueryData(queryKey, [
					...previous,
					{
						id: `optimistic-${variables.ruleGroupId}-${variables.corporationId}`,
						ruleGroupId: variables.ruleGroupId,
						corporationId: variables.corporationId,
					},
				])
			}

			return { previous, queryKey }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			queryClient.setQueryData(context.queryKey, context.previous)
		},
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId),
			})
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.corporations() })
		},
	})
}

export function useDetachCorporationFromRuleGroup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { ruleGroupId: string; corporationId: string }) =>
			corporationTaxApi.detachCorporationFromRuleGroup(input.ruleGroupId, input.corporationId),
		onMutate: async (variables) => {
			const queryKey = corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId)
			await queryClient.cancelQueries({ queryKey })
			const previous =
				queryClient.getQueryData<Array<{ id: string; ruleGroupId: string; corporationId: string }>>(
					queryKey
				) ?? []

			queryClient.setQueryData(
				queryKey,
				previous.filter((row) => row.corporationId !== variables.corporationId)
			)

			return { previous, queryKey }
		},
		onError: (_error, _variables, context) => {
			if (!context) return
			queryClient.setQueryData(context.queryKey, context.previous)
		},
		onSuccess: (_data, variables) => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.ruleGroupAttachments(variables.ruleGroupId),
			})
			void queryClient.invalidateQueries({ queryKey: corporationTaxKeys.ruleGroups() })
			void queryClient.invalidateQueries({ queryKey: [...corporationTaxKeys.all, 'rules'] })
		},
	})
}
