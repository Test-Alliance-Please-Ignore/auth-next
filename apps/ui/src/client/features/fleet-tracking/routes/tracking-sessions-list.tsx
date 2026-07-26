import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { UserSearchPaginationControls } from '@/components/user-search-pagination-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'
import { SessionStatusPill } from '../components/session-status-pill'
import { useTrackingSessions } from '../hooks'
import { formatDurationBetween } from '../utils/format'

import type { TrackingSessionStatus } from '../types'

type Tab = 'all' | TrackingSessionStatus

export function dateInputToIsoStart(value: string): string | undefined {
	if (!value) return undefined
	const [year, month, day] = value.split('-').map(Number)
	if (!year || !month || !day) return undefined
	return new Date(Date.UTC(year, month - 1, day)).toISOString()
}

export function dateInputToIsoEndExclusive(value: string): string | undefined {
	if (!value) return undefined
	const [year, month, day] = value.split('-').map(Number)
	if (!year || !month || !day) return undefined
	return new Date(Date.UTC(year, month - 1, day + 1)).toISOString()
}

export default function TrackingSessionsList() {
	usePageTitle('Fleet Tracking')
	const { hasPermission, isAdmin } = useUserPermissions()
	const canCreate = isAdmin || hasPermission('urn:fleet-tracking:create')
	const canViewAll = isAdmin || hasPermission('urn:fleet-tracking:view-all')
	const canViewFleets = canViewAll || hasPermission('urn:fleet-tracking:view-fleets')

	const [tab, setTab] = useState<Tab>('all')
	const [fromDate, setFromDate] = useState('')
	const [toDate, setToDate] = useState('')
	const [characterFilter, setCharacterFilter] = useState('')
	const [page, setPage] = useState(1)
	const [pageSize, setPageSize] = useState(25)

	const filter = useMemo(
		() => ({
			status: tab === 'all' ? undefined : tab,
			from: dateInputToIsoStart(fromDate),
			to: dateInputToIsoEndExclusive(toDate),
			characterId: characterFilter || undefined,
			limit: pageSize,
			offset: (page - 1) * pageSize,
		}),
		[tab, fromDate, toDate, characterFilter, page, pageSize]
	)
	const { data, isLoading } = useTrackingSessions(filter)

	const sessions = data?.items ?? []
	const total = data?.total ?? 0
	const hasPagination = Math.ceil(total / pageSize) > 1

	return (
		<Container>
			<PageHeader
				title="Fleet Tracking"
				description="Manually start and review fleet tracking sessions."
				action={
					canCreate && (
						<Button asChild>
							<Link to="/fleet-tracking/new">
								<Plus className="h-4 w-4" />
								Start Tracking
							</Link>
						</Button>
					)
				}
			/>

			<Section>
				<Card>
					<CardHeader className="pb-3">
						<CardTitle>Sessions</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{canViewFleets && (
							<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
								<div className="xl:col-span-2">
									<Select
										options={[]}
										value={characterFilter}
										onValueChange={(value) => {
											setCharacterFilter(value || '')
											setPage(1)
										}}
										searchable
										searchDelegate={async (query) => {
											const values = await api.searchCharacters(query)
											return values.map((entry) => ({
												value: entry.characterId,
												label: entry.characterName,
												description: entry.characterId,
											}))
										}}
										placeholder="FC character"
										minQueryLength={2}
										queryHintText="Type at least 2 characters"
										emptyText="No character names found"
										selectAllOption={{ value: '', label: 'All FCs' }}
									/>
								</div>
								<DateRangeInput
									value={{ fromDate, toDate }}
									onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
										setFromDate(nextFromDate)
										setToDate(nextToDate)
										setPage(1)
									}}
									placeholder="Session date range"
									className="[&_.themed-date-picker__input]:h-10"
								/>
								{(fromDate || toDate || characterFilter) && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => {
											setFromDate('')
											setToDate('')
											setCharacterFilter('')
											setPage(1)
										}}
									>
										Clear
									</Button>
								)}
							</div>
						)}

						<Tabs
							value={tab}
							onValueChange={(v) => {
								setTab(v as Tab)
								setPage(1)
							}}
						>
							<TabsList>
								<TabsTrigger value="all">All</TabsTrigger>
								<TabsTrigger value="active">Active</TabsTrigger>
								<TabsTrigger value="ended">Ended</TabsTrigger>
							</TabsList>
						</Tabs>

						{isLoading ? (
							<LoadingPage />
						) : sessions.length === 0 ? (
							<div className="py-10 text-center text-muted-foreground">
								No fleet tracking sessions match these filters.
							</div>
						) : (
							<>
								{hasPagination && (
									<div className="pb-3 border-b">
										<UserSearchPaginationControls
											totalCount={total}
											page={page}
											pageSize={pageSize}
											onPageChange={setPage}
											onPageSizeChange={(nextPageSize) => {
												setPageSize(nextPageSize)
												setPage(1)
											}}
											pageSizeOptions={[10, 25, 50]}
											itemLabel="sessions"
										/>
									</div>
								)}
								<div className="rounded-md border overflow-x-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Status</TableHead>
												<TableHead>Fleet</TableHead>
												<TableHead>FC</TableHead>
												<TableHead>Started</TableHead>
												<TableHead>Duration</TableHead>
												<TableHead className="w-20" />
											</TableRow>
										</TableHeader>
										<TableBody>
											{sessions.map((session) => (
										<TableRow key={session.id}>
											<TableCell>
												<SessionStatusPill status={session.status} />
											</TableCell>
											<TableCell className="font-medium">{session.name}</TableCell>
											<TableCell>
												<div className="leading-tight">
													<div>
														{session.currentFleetBossCharacterName ??
															session.currentCommanderCharacterName ??
															session.characterName ??
															'Unknown'}
													</div>
													<div className="text-xs text-muted-foreground font-mono">
														Tracked from: {session.characterId}
													</div>
												</div>
											</TableCell>
													<TableCell className="text-muted-foreground">
														<EveTimeDisplay dateStr={session.startedAt} />
													</TableCell>
													<TableCell className="text-muted-foreground">
														{formatDurationBetween(session.startedAt, session.endedAt)}
													</TableCell>
													<TableCell>
														<Button asChild variant="ghost" size="sm">
															<Link to={`/fleet-tracking/${session.id}`}>Open</Link>
														</Button>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								{hasPagination && (
									<div className="pt-3 border-t">
										<UserSearchPaginationControls
											totalCount={total}
											page={page}
											pageSize={pageSize}
											onPageChange={setPage}
											onPageSizeChange={(nextPageSize) => {
												setPageSize(nextPageSize)
												setPage(1)
											}}
											pageSizeOptions={[10, 25, 50]}
											itemLabel="sessions"
										/>
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
