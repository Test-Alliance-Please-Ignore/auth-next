import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { RegionMap } from '../components/RegionMap'
import { useMoonRegionDetail, useMoonRegions } from '../hooks'
import type { RegionSystemEntry } from '../types'

interface DotlanCoords {
	region: string
	viewbox: [number, number, number, number]
	systems: Record<string, [number, number]>
}

function regionNameToFile(name: string): string {
	return name.replace(/ /g, '_')
}

function secColor(secStatus: string | null): string {
	if (secStatus === null) return 'text-muted-foreground'
	const s = parseFloat(secStatus)
	if (s >= 0.5) return 'text-green-400'
	if (s > 0) return 'text-orange-400'
	return 'text-red-400'
}

function secLabel(secStatus: string | null): string {
	if (secStatus === null) return '?'
	return Math.max(0, parseFloat(secStatus)).toFixed(1)
}

function CoverageBar({ moonCount, verifiedCount }: { moonCount: number; verifiedCount: number }) {
	if (moonCount === 0) return <span className="text-xs text-muted-foreground">—</span>
	const pct = Math.round((verifiedCount / moonCount) * 100)
	return (
		<div className="flex items-center gap-1.5">
			<div className="h-3 w-20 overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full"
					style={{ width: `${pct}%`, background: '#28a745' }}
				/>
			</div>
			<span className="text-xs text-muted-foreground">{pct}%</span>
		</div>
	)
}

export default function RegionPage() {
	const { regionId } = useParams<{ regionId: string }>()
	const { hasPermission, isAdmin } = useUserPermissions()
	const canView = isAdmin || hasPermission('urn:moons:view')

	const { data: regionsData } = useMoonRegions()
	const { data: detail, isLoading, error } = useMoonRegionDetail(regionId!)

	const [coords, setCoords] = useState<DotlanCoords | null>(null)
	const [coordsError, setCoordsError] = useState(false)

	const regionName = regionsData?.regions.find((r) => r.regionId === regionId)?.regionName ?? regionId

	useEffect(() => {
		if (!regionName || regionName === regionId) return
		const file = regionNameToFile(regionName)
		fetch(`/dotlan/${file}.json`)
			.then((r) => {
				if (!r.ok) throw new Error('Not found')
				return r.json() as Promise<DotlanCoords>
			})
			.then(setCoords)
			.catch(() => setCoordsError(true))
	}, [regionName, regionId])

	if (!canView) {
		return (
			<Container>
				<PageHeader title="Region Map" description="You do not have permission to view moon data." />
			</Container>
		)
	}

	const systems = detail?.systems ?? []
	const totalMoons = systems.reduce((n, s) => n + s.moonCount, 0)
	const totalVerified = systems.reduce((n, s) => n + s.verifiedCount, 0)
	const coverage = totalMoons > 0 ? (totalVerified / totalMoons) * 100 : 0
	const eligibleSystems = systems.filter(
		(s) => s.securityStatus !== null && parseFloat(s.securityStatus) < 0.6
	)

	const sortedSystems = [...systems].sort((a, b) =>
		a.solarSystemName.localeCompare(b.solarSystemName)
	)

	return (
		<Container>
			<div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
				<Link to="/moon-scan" className="hover:underline">Moon Scanning</Link>
				<span>/</span>
				<span>{regionName}</span>
			</div>

			<div className="flex items-center justify-between">
				<PageHeader title={regionName as string} />
				<Button variant="ghost" size="sm" asChild>
					<Link to="/moon-scan">
						<ArrowLeft className="mr-2 h-4 w-4" />
						Back
					</Link>
				</Button>
			</div>

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
			) : detail && (
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
			)}

			{coordsError && (
				<div className="mt-4 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm text-yellow-400">
					No map coordinates available for this region.
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
					/>
				</div>
			)}

			{/* Systems table */}
			{!isLoading && detail && (
				<div className="mt-6 rounded-md border bg-card">
					<div className="border-b px-4 py-2.5 text-sm font-medium">
						Systems
						{eligibleSystems.length > 0 && (
							<span className="ml-2 text-xs text-muted-foreground">
								({eligibleSystems.length} eligible for moon mining)
							</span>
						)}
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									<th className="px-4 py-2 font-medium">System</th>
									<th className="px-4 py-2 font-medium">Security</th>
									<th className="px-4 py-2 font-medium text-right">Moons</th>
									<th className="px-4 py-2 font-medium text-right">Verified</th>
									<th className="px-4 py-2 font-medium">Coverage</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{sortedSystems.map((sys) => {
									const eligible =
										sys.securityStatus !== null && parseFloat(sys.securityStatus) < 0.6
									return (
										<tr
											key={sys.solarSystemId}
											className={eligible ? 'hover:bg-accent/50 transition-colors' : undefined}
										>
											<td className="px-4 py-2">
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
											</td>
											<td className={`px-4 py-2 font-mono text-xs ${secColor(sys.securityStatus)}`}>
												{secLabel(sys.securityStatus)}
											</td>
											<td className="px-4 py-2 text-right tabular-nums">{sys.moonCount || '—'}</td>
											<td className="px-4 py-2 text-right tabular-nums">{eligible ? sys.verifiedCount : '—'}</td>
											<td className="px-4 py-2">
												{eligible ? (
													<CoverageBar moonCount={sys.moonCount} verifiedCount={sys.verifiedCount} />
												) : (
													<span className="text-xs text-muted-foreground">—</span>
												)}
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</Container>
	)
}
