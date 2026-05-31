import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
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

import { OreCompositionBar } from '../components/OreCompositionBar'
import { ScanStatusBadge } from '../components/ScanStatusBadge'
import { useMoonSystemDetail } from '../hooks'
import { useMoonScanPermissions } from '../permissions'
import { securityStatusTextClass } from '../security-status'

export default function SystemPage() {
	const { systemId } = useParams<{ systemId: string }>()
	const { canView } = useMoonScanPermissions()

	const { data: detail, isLoading, error } = useMoonSystemDetail(systemId!)
	usePageTitle(detail?.system?.solarSystemName ? `${detail.system.solarSystemName}` : 'System')
	if (!canView) {
		return (
			<Container>
				<PageHeader
					title="System Detail"
					description="You do not have permission to view moon data."
				/>
			</Container>
		)
	}

	const sys = detail?.system
	const secStatus =
		sys?.securityStatus !== null && sys?.securityStatus !== undefined
			? parseFloat(sys.securityStatus)
			: null

	const secColor = securityStatusTextClass(secStatus)

	const verifiedMoons = (detail?.moons ?? []).filter((m) => m.isVerified).length
	const scannedMoons = (detail?.moons ?? []).filter((m) => m.hasScans).length

	return (
		<Container>
			<div className="mb-section md:mb-10">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-3">
						<div className="flex items-center gap-3">
							<h1 className="text-4xl md:text-5xl font-bold leading-none gradient-text">
								{sys?.solarSystemName ?? systemId!}
							</h1>
							{sys && (
								<span className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
									<span className="text-muted-foreground">Security</span>
									<span className={`font-mono font-semibold tabular-nums ${secColor}`}>
										{secStatus !== null ? secStatus.toFixed(2) : '—'}
									</span>
								</span>
							)}
						</div>
						<p className="text-muted-foreground text-lg">
							{isLoading
								? 'Loading…'
								: `${detail?.moons.length ?? 0} moons · ${scannedMoons} scanned · ${verifiedMoons} verified`}
						</p>
					</div>
					<div className="flex flex-col items-end gap-2">
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Link to="/moon-scan" className="hover:underline">
								Moon Scanning
							</Link>
							<span>/</span>
							<span>{sys?.solarSystemName ?? systemId}</span>
						</div>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/moon-scan">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back to Regions
							</Link>
						</Button>
					</div>
				</div>
			</div>

			{error && (
				<div className="mt-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-500">
					Failed to load system data
				</div>
			)}

			<div className="mt-section rounded-md border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Moon</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="w-96">Composition</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading
							? Array.from({ length: 4 }).map((_, i) => (
									<TableRow key={i}>
										{Array.from({ length: 3 }).map((__, j) => (
											<TableCell key={j}>
												<Skeleton className="h-4 w-28" />
											</TableCell>
										))}
									</TableRow>
								))
							: (detail?.moons ?? []).map((moon) => (
									<TableRow key={moon.moonId}>
										<TableCell>
											<Link
												to={`/moon-scan/moon/${moon.moonId}`}
												className="hover:underline text-foreground"
											>
												{moon.moonName}
											</Link>
										</TableCell>
										<TableCell>
											{moon.isVerified ? (
												<ScanStatusBadge status="verified" />
											) : moon.hasScans ? (
												<ScanStatusBadge status="pending" />
											) : (
												<Badge variant="ghost" className="text-muted-foreground">
													No data
												</Badge>
											)}
										</TableCell>
										<TableCell>
											{moon.composition ? (
												<OreCompositionBar ores={moon.composition.ores} />
											) : (
												<span className="text-xs text-muted-foreground">—</span>
											)}
										</TableCell>
									</TableRow>
								))}
						{!isLoading && detail?.moons.length === 0 && (
							<TableRow>
								<TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">
									No moons found in this system.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</Container>
	)
}
