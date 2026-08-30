import { CalendarClock, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { TIMERBOARD_KINDS, TIMERBOARD_PRIORITIES, TIMERBOARD_SIDES } from '@repo/core'

import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from '@/components/ui/sheet'
import { TimerboardDetail } from '@/features/timerboard/components/timerboard-detail'
import { TimerboardForm } from '@/features/timerboard/components/timerboard-form'
import { TimerboardList } from '@/features/timerboard/components/timerboard-list'
import { useTimerboard } from '@/features/timerboard/hooks'
import { canEditTimerboard, canViewTimerboard } from '@/features/timerboard/permissions'
import { useNowMs } from '@/hooks/useNowMs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { cn } from '@/lib/utils'

import type {
	TimerboardEntry,
	TimerboardListQuery,
	TimerKind,
	TimerPriority,
	TimerSide,
	TimerState,
} from '@/features/timerboard/types'

type BoardView = 'now' | 'next24' | 'next7' | 'later' | 'archived'

const viewLabels: Array<{ value: BoardView; label: string }> = [
	{ value: 'now', label: 'Now / overdue' },
	{ value: 'next24', label: 'Next 24h' },
	{ value: 'next7', label: 'Next 7d' },
	{ value: 'later', label: 'Later' },
	{ value: 'archived', label: 'Completed / cancelled' },
]

const controlClass =
	'rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const filterOptions = (allLabel: string, values: readonly string[]) => [
	{ value: '', label: allLabel },
	...values.map((value) => ({
		value,
		label: `${value[0]?.toUpperCase()}${value.slice(1)}`,
	})),
]

function isoAfter(anchor: number, durationMs: number): string {
	return new Date(anchor + durationMs).toISOString()
}

export default function TimerboardPage() {
	usePageTitle('Timerboard')
	const nowMs = useNowMs()
	const [rangeAnchor] = useState(() => Date.now())
	const [view, setView] = useState<BoardView>('next7')
	const [kind, setKind] = useState<TimerKind | ''>('')
	const [priority, setPriority] = useState<TimerPriority | ''>('')
	const [side, setSide] = useState<TimerSide | ''>('')
	const [system, setSystem] = useState('')
	const [assignedToMe, setAssignedToMe] = useState(false)
	const [page, setPage] = useState(1)
	const [creating, setCreating] = useState(false)
	const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
	const [editingEntry, setEditingEntry] = useState<TimerboardEntry | null>(null)
	const { permissions, isAdmin, isLoading: permissionsLoading } = useUserPermissions()
	const canView = canViewTimerboard(permissions, isAdmin)
	const canCreate = canEditTimerboard(permissions, isAdmin)

	const query = useMemo<TimerboardListQuery>(() => {
		let state: TimerState[] = ['planned', 'covered']
		let from: string | undefined
		let to: string | undefined
		if (view === 'now') to = new Date(rangeAnchor).toISOString()
		if (view === 'next24') to = isoAfter(rangeAnchor, 24 * 60 * 60 * 1000)
		if (view === 'next7') to = isoAfter(rangeAnchor, 7 * 24 * 60 * 60 * 1000)
		if (view === 'later') from = isoAfter(rangeAnchor, 7 * 24 * 60 * 60 * 1000)
		if (view === 'archived') state = ['completed', 'cancelled']
		return {
			state,
			kind: kind || undefined,
			priority: priority || undefined,
			side: side || undefined,
			system: system.trim() || undefined,
			assignedToMe,
			from,
			to,
			page,
			pageSize: 25,
		}
	}, [assignedToMe, kind, page, priority, rangeAnchor, side, system, view])
	const board = useTimerboard(query, canView && !permissionsLoading)
	const sheetOpen = creating || selectedEntryId !== null

	const changeView = (nextView: BoardView) => {
		setView(nextView)
		setPage(1)
	}
	const closeSheet = () => {
		setCreating(false)
		setSelectedEntryId(null)
		setEditingEntry(null)
	}

	if (!permissionsLoading && !canView) {
		return (
			<Container>
				<div className="rounded-lg border border-border p-8 text-center">
					<h1 className="text-2xl font-semibold">Timerboard unavailable</h1>
					<p className="mt-2 text-muted-foreground">
						You do not have permission to view the operational timerboard.
					</p>
				</div>
			</Container>
		)
	}

	return (
		<Container size="wide">
			<PageHeader
				title="Timerboard"
				description="Alliance operational timers in EVE time (UTC)."
				action={
					canCreate ? (
						<Button onClick={() => setCreating(true)}>
							<Plus />
							New timer
						</Button>
					) : undefined
				}
			/>

			<div className="mb-6 space-y-4 rounded-lg border border-border bg-card p-4">
				<div className="flex flex-wrap gap-2" aria-label="Time range filters">
					{viewLabels.map((option) => (
						<button
							key={option.value}
							type="button"
							aria-pressed={view === option.value}
							className={cn(
								'rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
								view === option.value
									? 'border-primary bg-primary text-primary-foreground'
									: 'border-border bg-background text-muted-foreground hover:text-foreground'
							)}
							onClick={() => changeView(option.value)}
						>
							{option.label}
						</button>
					))}
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
					<label
						className="text-xs font-medium text-muted-foreground"
						htmlFor="timerboard-kind-filter"
					>
						Kind
						<Select
							inputId="timerboard-kind-filter"
							className="mt-1"
							options={filterOptions('All kinds', TIMERBOARD_KINDS)}
							value={kind}
							onValueChange={(value) => {
								setKind(value as TimerKind | '')
								setPage(1)
							}}
						/>
					</label>
					<label
						className="text-xs font-medium text-muted-foreground"
						htmlFor="timerboard-priority-filter"
					>
						Priority
						<Select
							inputId="timerboard-priority-filter"
							className="mt-1"
							options={filterOptions('All priorities', TIMERBOARD_PRIORITIES)}
							value={priority}
							onValueChange={(value) => {
								setPriority(value as TimerPriority | '')
								setPage(1)
							}}
						/>
					</label>
					<label
						className="text-xs font-medium text-muted-foreground"
						htmlFor="timerboard-side-filter"
					>
						Side
						<Select
							inputId="timerboard-side-filter"
							className="mt-1"
							options={filterOptions('All sides', TIMERBOARD_SIDES)}
							value={side}
							onValueChange={(value) => {
								setSide(value as TimerSide | '')
								setPage(1)
							}}
						/>
					</label>
					<label className="text-xs font-medium text-muted-foreground">
						System
						<input
							className={cn(controlClass, 'mt-1 w-full')}
							value={system}
							maxLength={120}
							onChange={(event) => {
								setSystem(event.target.value)
								setPage(1)
							}}
							placeholder="Search system"
						/>
					</label>
					<label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
						<input
							type="checkbox"
							checked={assignedToMe}
							onChange={(event) => {
								setAssignedToMe(event.target.checked)
								setPage(1)
							}}
						/>
						Assigned to me
					</label>
				</div>
			</div>

			<TimerboardList
				entries={board.data?.items ?? []}
				nowMs={nowMs}
				isLoading={permissionsLoading || board.isLoading}
				error={board.error?.message}
				onSelect={(entry) => setSelectedEntryId(entry.id)}
			/>
			{board.data && board.data.total > board.data.pageSize ? (
				<div className="mt-4 flex items-center justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={page === 1}
						onClick={() => setPage((value) => Math.max(1, value - 1))}
					>
						Previous
					</Button>
					<span className="text-sm text-muted-foreground">Page {page}</span>
					<Button
						variant="ghost"
						size="sm"
						disabled={page * board.data.pageSize >= board.data.total}
						onClick={() => setPage((value) => value + 1)}
					>
						Next
					</Button>
				</div>
			) : null}

			<Sheet
				open={sheetOpen}
				onOpenChange={(open) => {
					if (!open) closeSheet()
				}}
			>
				<SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
					<SheetHeader className="mb-5">
						<SheetTitle className="flex items-center gap-2">
							<CalendarClock />
							{creating ? 'New timer' : editingEntry ? 'Edit timer' : 'Timer details'}
						</SheetTitle>
						<SheetDescription>All displayed and entered times are EVE time (UTC).</SheetDescription>
					</SheetHeader>
					{creating ? (
						<TimerboardForm
							onCancel={closeSheet}
							onSaved={(entry) => {
								setCreating(false)
								setSelectedEntryId(entry.id)
							}}
						/>
					) : editingEntry ? (
						<TimerboardForm
							entry={editingEntry}
							onCancel={() => setEditingEntry(null)}
							onSaved={(entry) => {
								setEditingEntry(null)
								setSelectedEntryId(entry.id)
							}}
						/>
					) : selectedEntryId ? (
						<TimerboardDetail entryId={selectedEntryId} onEdit={setEditingEntry} />
					) : null}
				</SheetContent>
			</Sheet>
		</Container>
	)
}
