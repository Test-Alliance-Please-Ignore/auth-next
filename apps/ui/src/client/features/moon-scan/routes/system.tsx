import { Link, useNavigate, useParams } from 'react-router-dom'

import { ArrowLeft } from 'lucide-react'

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
import { useUserPermissions } from '@/hooks/useUserPermissions'

import { OreCompositionBar } from '../components/OreCompositionBar'
import { useMoonSystemDetail } from '../hooks'

export default function SystemPage() {
	const { systemId } = useParams<{ systemId: string }>()
	const navigate = useNavigate()
	const { hasPermission, isAdmin } = useUserPermissions()
	const canView = isAdmin || hasPermission('urn:moons:view')

	const { data: detail, isLoading, error } = useMoonSystemDetail(systemId!)
	if (!canView) {
		return (
			<Container>
				<PageHeader title="System Detail" description="You do not have permission to view moon data." />
			</Container>
		)
	}

	const sys = detail?.system
	const secStatus = sys?.securityStatus !== null && sys?.securityStatus !== undefined
		? parseFloat(sys.securityStatus)
		: null

	const secColor =
		secStatus === null
			? 'text-muted-foreground'
			: secStatus >= 0.5
				? 'text-green-400'
				: secStatus > 0
					? 'text-yellow-400'
					: 'text-red-400'

	const verifiedMoons = (detail?.moons ?? []).filter((m) => m.isVerified).length
	const scannedMoons = (detail?.moons ?? []).filter((m) => m.hasScans).length

	return (
		<Container>
			<div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
				<Link to="/moon-scan" className="hover:underline">Moon Scanning</Link>
				<span>/</span>
				<span>{sys?.solarSystemName ?? systemId}</span>
			</div>

			<div className="flex items-center justify-between">
				<PageHeader
					title={sys?.solarSystemName ?? systemId!}
					description={
						isLoading
							? 'Loading…'
							: `${detail?.moons.length ?? 0} moons · ${scannedMoons} scanned · ${verifiedMoons} verified`
					}
				/>
				<Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
					<ArrowLeft className="mr-2 h-4 w-4" />
					Back
				</Button>
			</div>

			{sys && (
				<div className="mt-2 flex items-center gap-4 text-sm">
					<span className="text-muted-foreground">Security status:</span>
					<span className={`font-mono font-medium ${secColor}`}>
						{secStatus !== null ? secStatus.toFixed(2) : '—'}
					</span>
				</div>
			)}

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
											<TableCell key={j}><Skeleton className="h-4 w-28" /></TableCell>
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
												<Badge className="bg-green-500/20 text-green-400 border-green-500/30">Verified</Badge>
											) : moon.hasScans ? (
												<Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>
											) : (
												<Badge variant="outline" className="text-muted-foreground">No data</Badge>
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
