import { apiClient } from '@/lib/api'
import { downloadTextFile } from '@/lib/csv-utils'

import type {
	AdminSettings,
	ExtractionSettings,
	LeaderboardEntry,
	LeaderboardWindow,
	MoonDetail,
	MoonScan,
	MoonScanStatus,
	PaginatedScanQueue,
	PaginatedScans,
	ParseResult,
	RegionDetail,
	RegionsResponse,
	ScannedMoonsResponse,
	StructureProfile,
	StructureType,
	SubmitResult,
	SystemDetail,
	DotlanCoords,
} from './types'

export async function getScannedMoons(params: {
	page?: number
	pageSize?: number
	regionId?: string
	constellationId?: string
	rarities?: string[]
	search?: string
	sortBy?: string
	sortDir?: 'asc' | 'desc'
} = {}): Promise<ScannedMoonsResponse> {
	const qs = new URLSearchParams()
	if (params.page) qs.set('page', String(params.page))
	if (params.pageSize) qs.set('pageSize', String(params.pageSize))
	if (params.regionId && params.regionId !== 'all') qs.set('regionId', params.regionId)
	if (params.constellationId && params.constellationId !== 'all') qs.set('constellationId', params.constellationId)
	if (params.rarities && params.rarities.length > 0) qs.set('rarity', params.rarities.join(','))
	if (params.search?.trim()) qs.set('search', params.search.trim())
	if (params.sortBy) qs.set('sortBy', params.sortBy)
	if (params.sortDir) qs.set('sortDir', params.sortDir)
	const query = qs.toString()
	return apiClient.get(`/moon-scan/moons/verified${query ? `?${query}` : ''}`)
}

export async function requestScannedMoonsExport(params: {
	regionId?: string
	constellationId?: string
	rarities?: string[]
	search?: string
	sortBy?: string
	sortDir?: 'asc' | 'desc'
} = {}): Promise<{ workflowInstanceId: string; exportId: string; fileName: string; status: 'queued' }> {
	const qs = new URLSearchParams()
	if (params.regionId && params.regionId !== 'all') qs.set('regionId', params.regionId)
	if (params.constellationId && params.constellationId !== 'all') qs.set('constellationId', params.constellationId)
	if (params.rarities && params.rarities.length > 0) qs.set('rarity', params.rarities.join(','))
	if (params.search?.trim()) qs.set('search', params.search.trim())
	if (params.sortBy) qs.set('sortBy', params.sortBy)
	if (params.sortDir) qs.set('sortDir', params.sortDir)

	const query = qs.toString()
	return apiClient.post(`/moon-scan/moons/verified/export${query ? `?${query}` : ''}`, {})
}

export async function getScannedMoonsExportStatus(workflowInstanceId: string): Promise<{
	workflowInstanceId: string
	status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown'
	rawStatus?: string
	output: unknown | null
}> {
	return apiClient.get(`/moon-scan/moons/verified/export/${workflowInstanceId}`)
}

export async function downloadScannedMoonsExport(
	workflowInstanceId: string,
	fileName: string
): Promise<void> {
	const response = await fetch(`/api/moon-scan/moons/verified/export/${workflowInstanceId}/download`, {
		credentials: 'include',
		headers: {
			'X-Requested-With': 'XMLHttpRequest',
		},
	})
	if (!response.ok) {
		const message = await response.text()
		throw new Error(message || 'Failed to download scanned moons export')
	}

	const csv = await response.text()
	downloadTextFile(fileName, 'text/csv; charset=utf-8', csv)
}

export async function getRegions(): Promise<RegionsResponse> {
	return apiClient.get('/moon-scan/moons/regions')
}

export async function getRegionDetail(regionId: string): Promise<RegionDetail> {
	return apiClient.get(`/moon-scan/moons/region/${regionId}`)
}

export async function getDotlanRegionCoords(regionFile: string): Promise<DotlanCoords> {
	const response = await fetch(`/dotlan/${regionFile}.json`)
	const bodyText = await response.text()
	if (!response.ok) {
		throw new Error('No map coordinates available for this region')
	}
	try {
		return JSON.parse(bodyText) as DotlanCoords
	} catch {
		throw new Error('Invalid map coordinate payload for this region')
	}
}

export async function getSystemDetail(systemId: string): Promise<SystemDetail> {
	return apiClient.get(`/moon-scan/moons/system/${systemId}`)
}

export async function getMoonDetail(moonId: string): Promise<MoonDetail> {
	return apiClient.get(`/moon-scan/moons/${moonId}`)
}

export async function parseScanTsv(raw: string): Promise<ParseResult> {
	return apiClient.post('/moon-scan/scans/parse', { raw })
}

export async function submitScanTsv(raw: string): Promise<SubmitResult> {
	return apiClient.post('/moon-scan/scans/submit', { raw })
}

export async function getScans(params: {
	status?: MoonScanStatus
	moonId?: string
	page?: number
	pageSize?: number
}): Promise<PaginatedScans> {
	const qs = new URLSearchParams()
	if (params.status) qs.set('status', params.status)
	if (params.moonId) qs.set('moonId', params.moonId)
	if (params.page) qs.set('page', String(params.page))
	if (params.pageSize) qs.set('pageSize', String(params.pageSize))
	const query = qs.toString()
	return apiClient.get(`/moon-scan/scans${query ? `?${query}` : ''}`)
}

export async function getScanQueue(params: { page?: number; pageSize?: number } = {}): Promise<PaginatedScanQueue> {
	const qs = new URLSearchParams()
	if (params.page) qs.set('page', String(params.page))
	if (params.pageSize) qs.set('pageSize', String(params.pageSize))
	const query = qs.toString()
	return apiClient.get(`/moon-scan/scans/queue${query ? `?${query}` : ''}`)
}

export async function getMyScans(params: { page?: number; pageSize?: number } = {}): Promise<PaginatedScans> {
	const qs = new URLSearchParams()
	if (params.page) qs.set('page', String(params.page))
	if (params.pageSize) qs.set('pageSize', String(params.pageSize))
	const query = qs.toString()
	return apiClient.get(`/moon-scan/scans/mine${query ? `?${query}` : ''}`)
}

export async function getScan(id: string): Promise<MoonScan> {
	return apiClient.get(`/moon-scan/scans/${id}`)
}

export async function verifyScan(id: string, notes?: string): Promise<MoonScan> {
	return apiClient.post(`/moon-scan/scans/${id}/verify`, { notes })
}

export async function verifyScans(scanIds: string[]): Promise<MoonScan[]> {
	return apiClient.post('/moon-scan/scans/queue/verify-all', { scanIds })
}

export async function rejectScans(scanIds: string[]): Promise<MoonScan[]> {
	return apiClient.post('/moon-scan/scans/queue/reject-all', { scanIds })
}

export async function rejectScan(id: string, notes?: string): Promise<MoonScan> {
	return apiClient.post(`/moon-scan/scans/${id}/reject`, { notes })
}

export async function getLeaderboard(window: LeaderboardWindow): Promise<LeaderboardEntry[]> {
	return apiClient.get(`/moon-scan/leaderboard?window=${window}`)
}

export async function getAdminSettings(): Promise<AdminSettings> {
	return apiClient.get('/moon-scan/admin/settings')
}

export async function updateExtractionSettings(settings: Partial<ExtractionSettings>): Promise<ExtractionSettings> {
	return apiClient.post('/moon-scan/admin/settings', settings)
}

export async function updateStructureProfile(
	id: StructureType,
	profile: Partial<StructureProfile>
): Promise<StructureProfile> {
	return apiClient.post(`/moon-scan/admin/settings/profiles/${id}`, profile)
}
