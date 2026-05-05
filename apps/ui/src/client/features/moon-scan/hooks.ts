import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
	getAdminSettings,
	getLeaderboard,
	getMoonDetail,
	getMyScans,
	getRegionDetail,
	getRegions,
	getScan,
	getScanQueue,
	getScannedMoons,
	getScans,
	getSystemDetail,
	parseScanTsv,
	rejectScan,
	submitScanTsv,
	updateExtractionSettings,
	updateStructureProfile,
	verifyScan,
} from './api'
import { moonScanKeys } from './query-keys'

import type {
	ExtractionSettings,
	LeaderboardWindow,
	MoonScanStatus,
	StructureProfile,
	StructureType,
} from './types'

const STALE_5M = 1000 * 60 * 5
const STALE_1M = 1000 * 60

export function useScannedMoons() {
	return useQuery({
		queryKey: moonScanKeys.verifiedMoons(),
		queryFn: getScannedMoons,
		staleTime: STALE_5M,
	})
}

export function useMoonRegions() {
	return useQuery({
		queryKey: moonScanKeys.regions(),
		queryFn: getRegions,
		staleTime: STALE_5M,
	})
}

export function useMoonRegionDetail(regionId: string) {
	return useQuery({
		queryKey: moonScanKeys.region(regionId),
		queryFn: () => getRegionDetail(regionId),
		staleTime: STALE_5M,
	})
}

export function useMoonSystemDetail(systemId: string) {
	return useQuery({
		queryKey: moonScanKeys.system(systemId),
		queryFn: () => getSystemDetail(systemId),
		staleTime: STALE_1M,
	})
}

export function useMoonDetail(moonId: string) {
	return useQuery({
		queryKey: moonScanKeys.moon(moonId),
		queryFn: () => getMoonDetail(moonId),
		staleTime: STALE_1M,
	})
}

export function useScanList(params: {
	status?: MoonScanStatus
	moonId?: string
	page?: number
	pageSize?: number
}) {
	return useQuery({
		queryKey: moonScanKeys.scanList(params),
		queryFn: () => getScans(params),
		staleTime: STALE_1M,
	})
}

export function useScanQueue(params: { page?: number; pageSize?: number } = {}) {
	return useQuery({
		queryKey: moonScanKeys.queue(params),
		queryFn: () => getScanQueue(params),
		staleTime: STALE_1M,
	})
}

export function useMyScans(params: { page?: number; pageSize?: number } = {}) {
	return useQuery({
		queryKey: moonScanKeys.myScans(params),
		queryFn: () => getMyScans(params),
		staleTime: STALE_1M,
	})
}

export function useScan(id: string) {
	return useQuery({
		queryKey: moonScanKeys.scan(id),
		queryFn: () => getScan(id),
		staleTime: STALE_1M,
	})
}

export function useLeaderboard(window: LeaderboardWindow = 'all') {
	return useQuery({
		queryKey: moonScanKeys.leaderboard(window),
		queryFn: () => getLeaderboard(window),
		staleTime: STALE_5M,
	})
}

export function useAdminSettings() {
	return useQuery({
		queryKey: moonScanKeys.adminSettings(),
		queryFn: getAdminSettings,
		staleTime: STALE_5M,
	})
}

export function useParseScan() {
	return useMutation({
		mutationFn: (raw: string) => parseScanTsv(raw),
	})
}

export function useSubmitScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (raw: string) => submitScanTsv(raw),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: moonScanKeys.scans() })
			queryClient.invalidateQueries({ queryKey: moonScanKeys.leaderboard('all') })
		},
	})
}

export function useVerifyScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes?: string }) => verifyScan(id, notes),
		onSuccess: (scan) => {
			queryClient.invalidateQueries({ queryKey: moonScanKeys.scan(scan.id) })
			queryClient.invalidateQueries({ queryKey: moonScanKeys.scans() })
			queryClient.invalidateQueries({ queryKey: moonScanKeys.moon(scan.moonId) })
			queryClient.invalidateQueries({ queryKey: moonScanKeys.system('') })
		},
	})
}

export function useRejectScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes?: string }) => rejectScan(id, notes),
		onSuccess: (scan) => {
			queryClient.invalidateQueries({ queryKey: moonScanKeys.scan(scan.id) })
			queryClient.invalidateQueries({ queryKey: moonScanKeys.scans() })
		},
	})
}

export function useUpdateExtractionSettings() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (settings: Partial<ExtractionSettings>) => updateExtractionSettings(settings),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: moonScanKeys.adminSettings() })
		},
	})
}

export function useUpdateStructureProfile() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, profile }: { id: StructureType; profile: Partial<StructureProfile> }) =>
			updateStructureProfile(id, profile),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: moonScanKeys.adminSettings() })
		},
	})
}
