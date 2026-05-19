import type { LeaderboardWindow, MoonScanStatus } from './types'

export const moonScanKeys = {
	all: ['moon-scan'] as const,

	// Verified moons list
	verifiedMoons: (params: {
		page?: number
		pageSize?: number
		regionId?: string
		rarity?: string
		search?: string
		sortBy?: string
		sortDir?: 'asc' | 'desc'
	}) => [...moonScanKeys.all, 'verified-moons', params] as const,

	// Regions
	regions: () => [...moonScanKeys.all, 'regions'] as const,
	region: (regionId: string) => [...moonScanKeys.all, 'region', regionId] as const,
	dotlanRegion: (regionFile: string) => [...moonScanKeys.all, 'dotlan-region', regionFile] as const,

	// Systems
	systems: () => [...moonScanKeys.all, 'system'] as const,
	system: (systemId: string) => [...moonScanKeys.all, 'system', systemId] as const,

	// Moons
	moon: (moonId: string) => [...moonScanKeys.all, 'moon', moonId] as const,

	// Scans
	scans: () => [...moonScanKeys.all, 'scans'] as const,
	scanList: (params: { status?: MoonScanStatus; moonId?: string; page?: number; pageSize?: number }) =>
		[...moonScanKeys.scans(), 'list', params] as const,
	queue: (params: { page?: number; pageSize?: number }) =>
		[...moonScanKeys.scans(), 'queue', params] as const,
	myScans: (params: { page?: number; pageSize?: number }) =>
		[...moonScanKeys.scans(), 'mine', params] as const,
	scan: (id: string) => [...moonScanKeys.scans(), id] as const,

	// Leaderboard
	leaderboard: (window: LeaderboardWindow) => [...moonScanKeys.all, 'leaderboard', window] as const,

	// Admin
	admin: () => [...moonScanKeys.all, 'admin'] as const,
	adminSettings: () => [...moonScanKeys.admin(), 'settings'] as const,
}
