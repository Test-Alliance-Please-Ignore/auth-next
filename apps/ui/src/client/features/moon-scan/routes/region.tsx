import { ArrowLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'

import { RegionMap } from '../components/RegionMap'
import { useDotlanRegionCoords, useMoonRegionDetail, useMoonRegions } from '../hooks'
import { useMoonScanPermissions } from '../permissions'
import { parseSecurityStatus, securityStatusTextClass } from '../security-status'

function regionNameToFile(name: string): string {
	return name.replace(/ /g, '_')
}

function secLabel(secStatus: string | null): string {
	if (secStatus === null) return '?'
	const parsed = parseSecurityStatus(secStatus)
	if (parsed === null) return '?'
	return parsed.toFixed(1)
}

function CoverageBar({ moonCount, verifiedCount }: { moonCount: number; verifiedCount: number }) {
	if (moonCount === 0) return <span className="text-xs text-muted-foreground">—</span>
	const pct = Math.round((verifiedCount / moonCount) * 100)
	return (
		<div className="flex items-center gap-1.5">
			<div className="h-3 w-20 overflow-hidden rounded-full bg-muted">
				<div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
			</div>
			<span className="text-xs text-muted-foreground">{pct}%</span>
		</div>
	)
}

export default function RegionPage() {
	const { regionId } = useParams<{ regionId: string }>()
	const { canView } = useMoonScanPermissions()
	const [systemSearch, setSystemSearch] = useState('')

	const { data: regionsData } = useMoonRegions(canView)
	const { data: detail, isLoading, error } = useMoonRegionDetail(regionId!, canView)

	const regionName =
		regionsData?.regions.find((r) => r.regionId === regionId)?.regionName ?? regionId
	usePageTitle(regionName ? `Region — ${regionName}` : 'Region')
	const dotlanFile = useMemo(
		() => (regionName && regionName !== regionId ? regionNameToFile(regionName) : ''),
		[regionId, regionName]
	)
	const { data: coords, error: coordsError } = useDotlanRegionCoords(
		dotlanFile,
		canView && dotlanFile.length > 0
	)

	if (!canView) {
		return (
			<Container>
				<PageHeader
					title="Region Map"
					description="You do not have permission to view moon data."
				/>
			</Container>
		)
	}

	const systems = detail?.systems ?? []
	const totalMoons = systems.reduce((n, s) => n + s.moonCount, 0)
	const totalVerified = systems.reduce((n, s) => n + s.verifiedCount, 0)
	const coverage = totalMoons > 0 ? (totalVerified / totalMoons) * 100 : 0
	const eligibleSystems = systems.filter((s) => {
		const sec = parseSecurityStatus(s.securityStatus)
		return sec !== null && sec < 0.6
	})

	const sortedSystems = [...systems].sort((a, b) =>
		a.solarSystemName.localeCompare(b.solarSystemName)
	)
	const normalizedSystemSearch = systemSearch.trim().toLowerCase()
	const filteredSystems = normalizedSystemSearch
		? sortedSystems.filter((s) => s.solarSystemName.toLowerCase().includes(normalizedSystemSearch))
		: sortedSystems
	const highlightedSystemIds = useMemo(() => {
		if (!normalizedSystemSearch) return undefined
		return new Set(filteredSystems.map((s) => s.solarSystemId))
	}, [filteredSystems, normalizedSystemSearch])

	return (
		<Container>
			<PageHeader
				title={regionName as string}
				action={
					<div className="flex flex-col items-end gap-2">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Link to="/moon-scan" className="hover:underline">
								Moon Scanning
							</Link>
							<span>/</span>
							<span>{regionName}</span>
						</div>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/moon-scan">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back to Regions
							</Link>
						</Button>
					</div>
				}
			/>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load region data
				</div>
			)}

			{/* Stats row */}
			{isLoading ? (
				<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{Array.from({ length: 4 }).map((_, i) => (
						<Skeleton key={i} className="h-16 rounded-md" />
					))}
				</div>
			) : (
				detail && (
					<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
						<div className="rounded-md border bg-card p-3 text-center">
							<div className="text-2xl font-semibold">{systems.length}</div>
							<div className="text-xs text-muted-foreground mt-0.5">Systems</div>
						</div>
						<div className="rounded-md border bg-card p-3 text-center">
							<div className="text-2xl font-semibold">{totalMoons}</div>
							<div className="text-xs text-muted-foreground mt-0.5">Total Moons</div>
						</div>
						<div className="rounded-md border bg-card p-3 text-center">
							<div className="text-2xl font-semibold text-green-400">{totalVerified}</div>
							<div className="text-xs text-muted-foreground mt-0.5">Verified</div>
						</div>
						<div className="rounded-md border bg-card p-3 text-center">
							<div className="text-2xl font-semibold">{coverage.toFixed(1)}%</div>
							<div className="text-xs text-muted-foreground mt-0.5">Coverage</div>
						</div>
					</div>
				)
			)}

			{coordsError && (
				<div className="mt-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm text-yellow-400">
					{coordsError instanceof Error
						? coordsError.message
						: 'No map coordinates available for this region.'}
				</div>
			)}

			{isLoading && (
				<div className="mt-4">
					<Skeleton className="h-96 w-full rounded-md" />
				</div>
			)}

			{!isLoading && detail && coords && (
				<div className="mt-4">
					<RegionMap
						systems={detail.systems}
						jumpLinks={detail.jumpLinks}
						coords={coords}
						borderRegions={detail.borderRegions}
						highlightedSystemIds={highlightedSystemIds}
					/>
				</div>
			)}

			{/* Systems table */}
			{!isLoading && detail && (
				<div className="mt-6 rounded-md border bg-card">
					<div className="border-b px-4 py-2.5">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div className="text-sm font-medium">
								Systems
								{eligibleSystems.length > 0 && (
									<span className="ml-2 text-xs text-muted-foreground">
										({eligibleSystems.length} eligible for moon mining)
									</span>
								)}
							</div>
							<Input
								value={systemSearch}
								onChange={(e) => setSystemSearch(e.target.value)}
								placeholder="Filter systems..."
								className="h-8 w-full sm:w-64"
							/>
						</div>
					</div>
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>System</TableHead>
									<TableHead>Security</TableHead>
									<TableHead className="text-right">Moons</TableHead>
									<TableHead className="text-right">Verified</TableHead>
									<TableHead>Coverage</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filteredSystems.map((sys) => {
									const sec = parseSecurityStatus(sys.securityStatus)
									const eligible = sec !== null && sec < 0.6
									return (
										<TableRow
											key={sys.solarSystemId}
											className={eligible ? 'hover:bg-accent/50 transition-colors' : undefined}
										>
											<TableCell>
												{eligible ? (
													<Link
														to={`/moon-scan/system/${sys.solarSystemId}`}
														className="font-medium hover:underline"
													>
														{sys.solarSystemName}
													</Link>
												) : (
													<span className="text-muted-foreground">{sys.solarSystemName}</span>
												)}
											</TableCell>
											<TableCell className={`font-mono text-xs ${securityStatusTextClass(sec)}`}>
												{secLabel(sys.securityStatus)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{sys.moonCount || '—'}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{eligible ? sys.verifiedCount : '—'}
											</TableCell>
											<TableCell>
												{eligible ? (
													<CoverageBar
														moonCount={sys.moonCount}
														verifiedCount={sys.verifiedCount}
													/>
												) : (
													<span className="text-xs text-muted-foreground">—</span>
												)}
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
						{filteredSystems.length === 0 && (
							<div className="px-4 py-6 text-sm text-muted-foreground">
								No systems match the current filter.
							</div>
						)}
					</div>
				</div>
			)}
		</Container>
	)
}
