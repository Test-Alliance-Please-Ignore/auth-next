import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'

import { isTaxDemoModeEnabled, taxDemoApi } from '@/dev/tax-demo-mode'
import { useCorporationAccess } from '@/features/corporations'
import { useAuth } from '@/hooks/useAuth'
import { corporationTaxApi } from '@/lib/tax-api'
import { getScopedViewerCorporationIdsFromUrns } from '@/lib/tax-permissions'

import { corporationTaxKeys } from './keys'

import type { CorporationAccessRow, TaxCorporationScopeMode, TaxCorporationScopeRow } from './types'

export function resolveTaxCorporationScopeRows(input: {
	canManageGlobal: boolean
	canAuditGlobal: boolean
	hasScopedViewerPermissions: boolean
	viewerCorporationIds: Set<string>
	globalRows: TaxCorporationScopeRow[]
	fallbackRows: TaxCorporationScopeRow[]
	demoRows: TaxCorporationScopeRow[]
}): {
	scopeMode: TaxCorporationScopeMode
	rows: TaxCorporationScopeRow[]
} {
	const scopeMode: TaxCorporationScopeMode =
		input.canManageGlobal || input.canAuditGlobal
			? 'admin'
			: input.hasScopedViewerPermissions
				? 'auditor'
				: 'viewer'

	const baseRows =
		scopeMode === 'admin'
			? input.globalRows
			: scopeMode === 'auditor'
				? input.fallbackRows.filter((row) => input.viewerCorporationIds.has(row.corporationId))
				: input.fallbackRows
	const merged = new Map<string, TaxCorporationScopeRow>()
	for (const row of baseRows) {
		merged.set(row.corporationId, row)
	}
	for (const row of input.demoRows) {
		if (!merged.has(row.corporationId)) {
			merged.set(row.corporationId, row)
		}
	}

	return {
		scopeMode,
		rows: Array.from(merged.values()),
	}
}

export function useTaxCapabilities(corporationId?: string, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.capabilities(corporationId),
		queryFn: () => corporationTaxApi.getCapabilities(corporationId),
		staleTime: 1000 * 60 * 5,
		enabled,
	})
}

export function useTaxCorporations(filters?: {
	limit?: number
	offset?: number
	enabled?: boolean
}) {
	const enabled = filters?.enabled ?? true
	const demoEnabled = isTaxDemoModeEnabled()
	const { permissions } = useAuth()
	const { data: globalCapabilities, isLoading: capabilitiesLoading } = useTaxCapabilities(
		undefined,
		enabled
	)
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()
	const canManageGlobal = globalCapabilities?.global.canManage ?? false
	const canAuditGlobal = globalCapabilities?.global.canAudit ?? false
	const viewerCorporationIds = useMemo(
		() =>
			getScopedViewerCorporationIdsFromUrns(
				(permissions ?? []).map((permission) => permission.urn)
			),
		[permissions]
	)
	const hasScopedViewerPermissions = viewerCorporationIds.size > 0
	const scopeMode: TaxCorporationScopeMode =
		canManageGlobal || canAuditGlobal ? 'admin' : hasScopedViewerPermissions ? 'auditor' : 'viewer'

	const taxCorporationsQuery = useQuery({
		queryKey: corporationTaxKeys.corporationList(filters),
		queryFn: () => corporationTaxApi.listCorporations(filters),
		staleTime: 1000 * 60 * 10,
		enabled: enabled && scopeMode === 'admin',
	})
	const demoCorporationsQuery = useQuery({
		queryKey: [...corporationTaxKeys.corporationList(filters), 'demo'],
		queryFn: () => taxDemoApi.listCorporations(filters),
		staleTime: 1000 * 60 * 10,
		enabled: enabled && demoEnabled,
	})

	const fallbackRows: TaxCorporationScopeRow[] = useMemo(() => {
		const fallbackDate = new Date(0)
		return ((corporationAccess?.corporations ?? []) as CorporationAccessRow[]).map(
			(corporation) => ({
				corporationId: corporation.corporationId,
				included: true,
				exclusionReason: null as string | null,
				createdAt: fallbackDate,
				updatedAt: fallbackDate,
			})
		)
	}, [corporationAccess?.corporations])

	const resolvedScope = useMemo(
		() =>
			resolveTaxCorporationScopeRows({
				canManageGlobal,
				canAuditGlobal,
				hasScopedViewerPermissions,
				viewerCorporationIds,
				globalRows: (taxCorporationsQuery.data ?? []) as TaxCorporationScopeRow[],
				fallbackRows,
				demoRows: (demoCorporationsQuery.data ?? []) as TaxCorporationScopeRow[],
			}),
		[
			canManageGlobal,
			canAuditGlobal,
			hasScopedViewerPermissions,
			viewerCorporationIds,
			taxCorporationsQuery.data,
			fallbackRows,
			demoCorporationsQuery.data,
		]
	)

	return {
		...taxCorporationsQuery,
		data: resolvedScope.rows,
		scopeMode: resolvedScope.scopeMode,
		isLoading:
			enabled &&
			(capabilitiesLoading ||
				corporationAccessLoading ||
				(resolvedScope.scopeMode === 'admin' && taxCorporationsQuery.isLoading) ||
				demoCorporationsQuery.isLoading),
		isFetching:
			enabled &&
			(taxCorporationsQuery.isFetching ||
				demoCorporationsQuery.isFetching ||
				capabilitiesLoading ||
				corporationAccessLoading),
	}
}

export function useTaxWalletDivisions(corporationId: string | undefined, enabled = true) {
	return useQuery({
		queryKey: corporationTaxKeys.walletDivisions(corporationId ?? 'none'),
		queryFn: () => corporationTaxApi.listWalletDivisions(corporationId!),
		staleTime: 1000 * 60 * 30,
		enabled: Boolean(corporationId) && enabled,
	})
}

export function useTaxExclusions(filters?: { limit?: number; offset?: number; enabled?: boolean }) {
	return useQuery({
		queryKey: corporationTaxKeys.exclusionsList(filters),
		queryFn: () => corporationTaxApi.listExclusions(filters),
		staleTime: 1000 * 60 * 5,
		enabled: filters?.enabled ?? true,
	})
}

export function useUpsertTaxExclusion() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: { corporationId: string; reason: string | null }) =>
			corporationTaxApi.upsertExclusion(input.corporationId, { reason: input.reason }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.corporations(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.exclusions(),
			})
		},
	})
}

export function useDeleteTaxExclusion() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (corporationId: string) => corporationTaxApi.deleteExclusion(corporationId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.corporations(),
			})
			void queryClient.invalidateQueries({
				queryKey: corporationTaxKeys.exclusions(),
			})
		},
	})
}
