import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
	getAdminSettings,
	getDotlanRegionCoords,
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

function invalidateMoonReadModels(queryClient: ReturnType<typeof useQueryClient>): void {
	void queryClient.invalidateQueries({ queryKey: [...moonScanKeys.all, 'verified-moons'] })
	void queryClient.invalidateQueries({ queryKey: moonScanKeys.regions() })
	void queryClient.invalidateQueries({ queryKey: moonScanKeys.systems() })
}

export function useScannedMoons(params: {
	page?: number
	pageSize?: number
	regionId?: string
	constellationId?: string
	rarities?: string[]
	search?: string
	sortBy?: 'metenox' | 'tatara'
	sortDir?: 'asc' | 'desc'
} = {}) {
	return useQuery({
		queryKey: moonScanKeys.verifiedMoons(params),
		queryFn: () => getScannedMoons(params),
		staleTime: STALE_5M,
		placeholderData: keepPreviousData,
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

export function useDotlanRegionCoords(regionFile: string, enabled: boolean) {
	return useQuery({
		queryKey: moonScanKeys.dotlanRegion(regionFile),
		queryFn: () => getDotlanRegionCoords(regionFile),
		staleTime: STALE_5M,
		enabled,
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
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.scans() })
			void queryClient.invalidateQueries({ queryKey: [...moonScanKeys.scans(), 'mine'] })
			void queryClient.invalidateQueries({ queryKey: [...moonScanKeys.scans(), 'queue'] })
			void queryClient.invalidateQueries({ queryKey: [...moonScanKeys.all, 'leaderboard'] })
			invalidateMoonReadModels(queryClient)
		},
	})
}

export function useVerifyScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes?: string }) => verifyScan(id, notes),
		onSuccess: (scan) => {
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.scan(scan.id) })
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.scans() })
			void queryClient.invalidateQueries({ queryKey: [...moonScanKeys.scans(), 'queue'] })
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.moon(scan.moonId) })
			invalidateMoonReadModels(queryClient)
		},
	})
}

export function useRejectScan() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, notes }: { id: string; notes?: string }) => rejectScan(id, notes),
		onSuccess: (scan) => {
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.scan(scan.id) })
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.scans() })
			void queryClient.invalidateQueries({ queryKey: [...moonScanKeys.scans(), 'queue'] })
		},
	})
}

export function useUpdateExtractionSettings() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (settings: Partial<ExtractionSettings>) => updateExtractionSettings(settings),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.adminSettings() })
			invalidateMoonReadModels(queryClient)
		},
	})
}

export function useUpdateStructureProfile() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, profile }: { id: StructureType; profile: Partial<StructureProfile> }) =>
			updateStructureProfile(id, profile),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: moonScanKeys.adminSettings() })
			invalidateMoonReadModels(queryClient)
		},
	})
}
