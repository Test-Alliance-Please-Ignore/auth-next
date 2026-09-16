import { ArrowLeft, Download } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useCorporationAccess } from '@/features/corporations'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'

import { CorporationParticipationExportDialog } from '../components/corporation-participation-export-dialog'
import { RankingList } from '../components/ranking-list'
import { SessionStatsGrid } from '../components/session-stats-grid'
import { ShipDistributionChart } from '../components/ship-distribution-chart'
import { StatsRangePicker, useRangeFromSearchParams } from '../components/stats-range-picker'
import { useCorporationStats } from '../hooks'
import { formatDuration } from '../utils/format'

export default function CorporationStats() {
	const { t } = useAppTranslation()

	const { corpId } = useParams<{ corpId: string }>()
	const { range } = useRangeFromSearchParams()
	const { isAdmin, hasPermission } = useUserPermissions()
	const canViewAll = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const { data: corporationAccess, isLoading: corporationAccessLoading } = useCorporationAccess()
	const memberCorporation = corporationAccess?.corporations.find(
		(corp) => corp.corporationId === corpId && corp.isMemberCorporation
	)
	const canView = canViewAll || !!memberCorporation
	const [exportOpen, setExportOpen] = useState(false)

	const { data, isLoading } = useCorporationStats(canView ? corpId : undefined, range, {
		enabled: canView,
	})
	usePageTitle(
		data?.corporationName
			? t('fleetTracking.value1CorporationStats', { value1: data.corporationName })
			: t('fleetTracking.corporationStats')
	)

	if (!corpId) return <Navigate to="/fleet-tracking/stats" replace />

	if (!canView && corporationAccessLoading) {
		return <LoadingPage />
	}

	if (!canView) {
		return (
			<Container>
				<PageHeader
					title={t('fleetTracking.corporationStats')}
					action={
						<Button asChild variant="ghost" size="sm">
							<Link to="/fleet-tracking">
								<ArrowLeft className="h-4 w-4" />
								{t('fleetTracking.fleetTracking')}
							</Link>
						</Button>
					}
				/>
				<div className="py-12 text-center text-muted-foreground">
					{t('fleetTracking.youDoNotHavePermissionToViewCorporationFleetTracking')}
				</div>
			</Container>
		)
	}

	return (
		<Container>
			<PageHeader
				title={data?.corporationName ?? t('fleetTracking.corporationStats')}
				action={
					<div className="flex items-center gap-2">
						<Button size="sm" onClick={() => setExportOpen(true)}>
							<Download className="h-4 w-4" />
							{t('fleetTracking.exportCsv')}
						</Button>
						<Button asChild variant="ghost" size="sm">
							<Link to="/fleet-tracking/stats">
								<ArrowLeft className="h-4 w-4" />
								{t('fleetTracking.stats')}
							</Link>
						</Button>
					</div>
				}
			/>
			<CorporationParticipationExportDialog
				corporationId={corpId}
				open={exportOpen}
				onOpenChange={setExportOpen}
			/>
			<div className="mb-6 flex items-start justify-end gap-4 flex-wrap">
				<StatsRangePicker />
			</div>

			{isLoading ? (
				<LoadingPage />
			) : !data ? (
				<div className="py-12 text-center text-sm text-muted-foreground">
					{t('fleetTracking.noData2')}
				</div>
			) : (
				<div className="space-y-6">
					<SessionStatsGrid
						stats={[
							{ label: t('fleetTracking.pilotsActive'), value: data.totals.pilotsActive },
							{ label: t('fleetTracking.pilotHours'), value: data.totals.pilotHours },
							{
								label: t('fleetTracking.fleetsWithPresence'),
								value: data.totals.sessionsWithPresence,
							},
							{ label: t('fleetTracking.avgPilotsFleet'), value: data.totals.avgPilotsPerSession },
						]}
					/>

					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<RankingList
							title={t('fleetTracking.topParticipatingMembers')}
							items={data.topMembers}
							emptyText={t('fleetTracking.noMembersInThisRange')}
							renderItem={(r) => (
								<div className="flex items-center justify-between">
									<Link
										to={`/fleet-tracking/stats/characters/${r.characterId}`}
										className="hover:underline"
									>
										{r.characterName}
									</Link>
									<span className="text-muted-foreground">
										{r.fleetsJoined}
										{t('fleetTracking.fleets')}
										{formatDuration(r.minutesInFleet * 60_000)}
									</span>
								</div>
							)}
						/>
						<RankingList
							title={t('fleetTracking.topFcsFromThisCorp')}
							items={data.topFCs}
							emptyText={t('fleetTracking.noFcsInThisRange')}
							renderItem={(r) => (
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<Link
											to={`/fleet-tracking/stats/characters/${r.characterId}`}
											className="hover:underline"
										>
											{r.characterName}
										</Link>
										<div className="text-xs text-muted-foreground">
											{formatDuration((r.minutesAsFC ?? 0) * 60_000)}
											{t('fleetTracking.active2')}
										</div>
									</div>
									<span className="text-muted-foreground">
										{r.sessions}
										{t('fleetTracking.sessions')}
									</span>
								</div>
							)}
						/>
					</div>

					<ShipDistributionChart
						title={t('fleetTracking.shipsFlownByThisCorpSMembers')}
						items={data.shipsFlown.map((s) => ({
							shipTypeId: s.shipTypeId,
							shipTypeName: s.shipTypeName,
							totalMinutes: s.totalMinutes,
						}))}
					/>
				</div>
			)}
		</Container>
	)
}
