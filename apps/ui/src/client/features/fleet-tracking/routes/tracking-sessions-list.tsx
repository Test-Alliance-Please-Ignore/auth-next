import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingPage } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { SessionCard } from '../components/session-card'
import { useTrackingSessions } from '../hooks'

import type { TrackingSessionStatus } from '../types'

type Tab = 'all' | TrackingSessionStatus

const PAGE_SIZE = 20

/**
 * Convert a YYYY-MM-DD date input into an ISO timestamp at start-of-day (UTC).
 * Returns undefined for empty input.
 */
function dateInputToIsoStart(value: string): string | undefined {
	if (!value) return undefined
	const [year, month, day] = value.split('-').map(Number)
	if (!year || !month || !day) return undefined
	return new Date(Date.UTC(year, month - 1, day)).toISOString()
}

/**
 * Convert a YYYY-MM-DD date input into an ISO timestamp at start of the NEXT day (UTC),
 * so the filter `to` (exclusive) includes the entire selected day.
 */
function dateInputToIsoEndExclusive(value: string): string | undefined {
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

	const [tab, setTab] = useState<Tab>('all')
	const [fromDate, setFromDate] = useState('')
	const [toDate, setToDate] = useState('')
	const [fcSearch, setFcSearch] = useState('')
	const [page, setPage] = useState(0)

	const filter = useMemo(
		() => ({
			status: tab === 'all' ? undefined : tab,
			from: dateInputToIsoStart(fromDate),
			to: dateInputToIsoEndExclusive(toDate),
			limit: PAGE_SIZE,
			offset: page * PAGE_SIZE,
		}),
		[tab, fromDate, toDate, page]
	)
	const { data, isLoading } = useTrackingSessions(filter)

	const sessions = data?.items ?? []
	const total = data?.total ?? 0

	// Client-side FC name filter on the loaded page. Documented as "page filter"
	// so users don't get confused that an empty page might still have matches elsewhere.
	const visibleSessions = useMemo(() => {
		const q = fcSearch.trim().toLowerCase()
		if (!q) return sessions
		return sessions.filter(
			(s) =>
				(s.characterName ?? '').toLowerCase().includes(q) ||
				s.characterId.includes(q) ||
				s.name.toLowerCase().includes(q)
		)
	}, [sessions, fcSearch])

	const onTabChange = (next: Tab) => {
		setTab(next)
		setPage(0)
	}
	const onFromChange = (next: string) => {
		setFromDate(next)
		setPage(0)
	}
	const onToChange = (next: string) => {
		setToDate(next)
		setPage(0)
	}

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
	const hasNext = page + 1 < totalPages
	const hasPrev = page > 0
	const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1
	const rangeEnd = Math.min(total, page * PAGE_SIZE + sessions.length)

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
				<div className="flex flex-wrap items-end gap-3 mb-4">
					<Tabs value={tab} onValueChange={(v) => onTabChange(v as Tab)}>
						<TabsList>
							<TabsTrigger value="all">All</TabsTrigger>
							<TabsTrigger value="active">Active</TabsTrigger>
							<TabsTrigger value="ended">Ended</TabsTrigger>
						</TabsList>
					</Tabs>

					{canViewAll && (
						<>
							<div className="space-y-1">
								<Label htmlFor="fc-search" className="text-xs">
									FC / fleet name
								</Label>
								<Input
									id="fc-search"
									value={fcSearch}
									onChange={(e) => setFcSearch(e.target.value)}
									placeholder="Filter visible rows"
									className="h-8 w-56"
								/>
							</div>
							<div className="space-y-1">
								<Label className="text-xs">From</Label>
								<div className="w-40">
									<DateInput value={fromDate} onChange={onFromChange} />
								</div>
							</div>
							<div className="space-y-1">
								<Label className="text-xs">To</Label>
								<div className="w-40">
									<DateInput value={toDate} onChange={onToChange} />
								</div>
							</div>
							{(fromDate || toDate || fcSearch) && (
								<Button
									variant="ghost"
									size="sm"
									onClick={() => {
										setFromDate('')
										setToDate('')
										setFcSearch('')
										setPage(0)
									}}
								>
									Clear
								</Button>
							)}
						</>
					)}
				</div>

				{isLoading ? (
					<LoadingPage />
				) : visibleSessions.length === 0 ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-muted-foreground mb-4">
								{sessions.length === 0
									? 'No fleet tracking sessions match these filters.'
									: 'No sessions match the search on this page.'}
							</p>
							{canCreate && (
								<Button asChild>
									<Link to="/fleet-tracking/new">
										<Plus className="h-4 w-4" />
										Start Tracking
									</Link>
								</Button>
							)}
						</CardContent>
					</Card>
				) : (
					<>
						<div className="space-y-3">
							{visibleSessions.map((s) => (
								<SessionCard key={s.id} session={s} />
							))}
						</div>
						<div className="flex items-center justify-between text-xs text-muted-foreground pt-3">
							<div>
								Showing {rangeStart}–{rangeEnd} of {total}
								{fcSearch && sessions.length !== visibleSessions.length && (
									<span> · {visibleSessions.length} on this page after search</span>
								)}
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant="ghost"
									size="sm"
									disabled={!hasPrev}
									onClick={() => setPage((p) => Math.max(0, p - 1))}
								>
									Previous
								</Button>
								<span>
									Page {page + 1} of {totalPages}
								</span>
								<Button
									variant="ghost"
									size="sm"
									disabled={!hasNext}
									onClick={() => setPage((p) => p + 1)}
								>
									Next
								</Button>
							</div>
						</div>
					</>
				)}
			</Section>
		</Container>
	)
}
