import {
	Anchor,
	Antenna,
	Building2,
	CalendarClock,
	Castle,
	Circle,
	CircleDot,
	DollarSign,
	Factory,
	House,
	LayoutList,
	Moon,
	Plus,
	Shield,
	ShieldAlert,
	TowerControl,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { TIMERBOARD_CATEGORIES, TIMERBOARD_HOSTILITIES, TIMERBOARD_PRIORITIES } from '@repo/core'

import { CorporationLogo, OrganizationLogo } from '@/components/corporation-logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TimerboardDetail } from '@/features/timerboard/components/timerboard-detail'
import { TimerboardForm } from '@/features/timerboard/components/timerboard-form'
import { TimerboardList } from '@/features/timerboard/components/timerboard-list'
import { useTimerboard } from '@/features/timerboard/hooks'
import { canEditTimerboard, canViewTimerboard } from '@/features/timerboard/permissions'
import {
	timerboardCategoryOptions,
	timerboardTimerTypeOptions,
	timerboardTypeToneClasses,
} from '@/features/timerboard/timerboard-visuals'
import { useNowMs } from '@/hooks/useNowMs'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'

import type {
	TimerboardEntry,
	TimerboardListQuery,
	TimerCategory,
	TimerHostility,
	TimerPriority,
	TimerState,
	TimerType,
} from '@/features/timerboard/types'

type BoardView = 'now' | 'next24' | 'next7' | 'later' | 'archived'
type TimerboardKindTab = TimerCategory | 'all'

const viewLabels: Array<{ value: BoardView; label: string }> = [
	{ value: 'now', label: 'Now / overdue' },
	{ value: 'next24', label: 'Next 24h' },
	{ value: 'next7', label: 'Next 7d' },
	{ value: 'later', label: 'Later' },
	{ value: 'archived', label: 'Completed / cancelled' },
]

const kindLabels: Record<TimerboardKindTab, string> = {
	all: 'All timers',
	structure: 'Structures',
	sovereignty: 'Sovereignty',
	skyhook: 'Skyhooks',
	moon: 'Moons',
	fleet: 'Fleets',
	custom: 'Custom',
}

const kindTabs: Array<{
	value: TimerboardKindTab
	label: string
	icon: typeof LayoutList
	tone?: string
}> = [
	{ value: 'all', label: kindLabels.all, icon: LayoutList },
	...TIMERBOARD_CATEGORIES.map((value) => {
		const option = timerboardCategoryOptions.find((item) => item.value === value)
		return {
			value,
			label: kindLabels[value],
			icon: option?.icon ?? LayoutList,
			tone: option?.tone,
		}
	}),
]

const structureTypeOptions: Array<{
	value: string
	label: string
	icon: typeof Building2
	tone: 'blue' | 'yellow' | 'green' | 'purple' | 'red' | 'gray'
}> = [
	{ value: 'upwell_citadel_keepstar', label: 'Keepstar', icon: Building2, tone: 'blue' },
	{ value: 'upwell_citadel_fortizar', label: 'Fortizar', icon: Castle, tone: 'blue' },
	{ value: 'upwell_citadel_astrahus', label: 'Astrahus', icon: House, tone: 'blue' },
	{ value: 'upwell_engineering_sotiyo', label: 'Sotiyo', icon: Factory, tone: 'yellow' },
	{ value: 'upwell_engineering_azbel', label: 'Azbel', icon: Factory, tone: 'yellow' },
	{ value: 'upwell_engineering_raitaru', label: 'Raitaru', icon: Factory, tone: 'yellow' },
	{ value: 'upwell_refinery_tatara', label: 'Tatara', icon: Factory, tone: 'yellow' },
	{ value: 'upwell_refinery_athanor', label: 'Athanor', icon: Factory, tone: 'yellow' },
	{ value: 'ansiblex_jump_bridge', label: 'Ansiblex Jump Gate', icon: Circle, tone: 'green' },
	{ value: 'pharolux_cyno_beacon', label: 'Pharolux Cyno Beacon', icon: CircleDot, tone: 'green' },
	{ value: 'tenebrex_cyno_jammer', label: 'Tenebrex Cyno Jammer', icon: CircleDot, tone: 'green' },
	{ value: 'orbital_skyhook', label: 'Orbital Skyhook', icon: TowerControl, tone: 'purple' },
	{ value: 'sovereignty_hub', label: 'Sovereignty Hub', icon: Shield, tone: 'purple' },
	{ value: 'player_owned_starbase', label: 'Starbase (POS)', icon: Antenna, tone: 'blue' },
	{ value: 'metenox_moon_drill', label: 'Metenox Moon Drill', icon: Moon, tone: 'gray' },
	{ value: 'mercenary_den', label: 'Mercenary Den', icon: ShieldAlert, tone: 'red' },
	{ value: 'customs_office_poco', label: 'Customs Office (POCO)', icon: DollarSign, tone: 'gray' },
	{ value: 'custom', label: 'Other / custom', icon: Anchor, tone: 'gray' },
]

const structureToneClasses: Record<(typeof structureTypeOptions)[number]['tone'], string> = {
	blue: 'text-sky-300',
	yellow: 'text-amber-300',
	green: 'text-emerald-300',
	purple: 'text-purple-300',
	red: 'text-rose-300',
	gray: 'text-muted-foreground',
}

const priorityStyles: Record<TimerPriority, string> = {
	critical: 'bg-destructive',
	high: 'bg-orange-500',
	normal: 'bg-primary',
	low: 'bg-muted-foreground',
}

const hostilityVariants: Record<TimerHostility, 'ghost' | 'success' | 'warning' | 'destructive'> = {
	friendly: 'success',
	neutral: 'ghost',
	hostile: 'destructive',
	unknown: 'warning',
}

const TIMERBOARD_FILTER_STORAGE_KEY = 'timerboard.filters.v1'
type PersistedTimerboardFilters = Partial<{
	view: BoardView
	category: TimerboardKindTab
	timerTypes: TimerType[]
	priorities: TimerPriority[]
	hostilities: TimerHostility[]
	system: string
	structureTypes: string[]
	organizations: string[]
	assignedToMe: boolean
}>

function readPersistedFilters(): PersistedTimerboardFilters {
	if (typeof window === 'undefined') return {}
	try {
		return JSON.parse(sessionStorage.getItem(TIMERBOARD_FILTER_STORAGE_KEY) ?? '{}')
	} catch {
		return {}
	}
}

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
	const [persisted] = useState(readPersistedFilters)
	const [rangeAnchor] = useState(() => Date.now())
	const [view, setView] = useState<BoardView>(persisted.view ?? 'next7')
	const [category, setCategory] = useState<TimerboardKindTab>(persisted.category ?? 'all')
	const [timerTypes, setTimerTypes] = useState<TimerType[]>(persisted.timerTypes ?? [])
	const [priorities, setPriorities] = useState<TimerPriority[]>(persisted.priorities ?? [])
	const [hostilities, setHostilities] = useState<TimerHostility[]>(persisted.hostilities ?? [])
	const [system, setSystem] = useState(persisted.system ?? '')
	const [structureTypes, setStructureTypes] = useState<string[]>(persisted.structureTypes ?? [])
	const [organizations, setOrganizations] = useState<string[]>(persisted.organizations ?? [])
	const [assignedToMe, setAssignedToMe] = useState(persisted.assignedToMe ?? false)
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
			category: category === 'all' ? undefined : category,
			timerTypes: timerTypes.length ? timerTypes : undefined,
			priorities: priorities.length ? priorities : undefined,
			hostilities: hostilities.length ? hostilities : undefined,
			subjectTypes: structureTypes.length ? structureTypes : undefined,
			organizations: organizations.length ? organizations : undefined,
			system: system.trim() || undefined,
			assignedToMe,
			from,
			to,
			page,
			pageSize: 25,
		}
	}, [
		assignedToMe,
		category,
		hostilities,
		organizations,
		page,
		priorities,
		rangeAnchor,
		structureTypes,
		system,
		timerTypes,
		view,
	])
	useEffect(() => {
		if (typeof window === 'undefined') return
		sessionStorage.setItem(
			TIMERBOARD_FILTER_STORAGE_KEY,
			JSON.stringify({
				view,
				category,
				timerTypes,
				priorities,
				hostilities,
				system,
				structureTypes,
				organizations,
				assignedToMe,
			})
		)
	}, [
		assignedToMe,
		category,
		hostilities,
		organizations,
		priorities,
		structureTypes,
		system,
		timerTypes,
		view,
	])
	const board = useTimerboard(query, canView && !permissionsLoading)
	const organizationOptions = useMemo(() => {
		const options = (board.data?.items ?? []).flatMap((item) => {
			const result: Array<{
				value: string
				label: string
				organizationType: 'corporation' | 'alliance'
				corporationId: string
				corporationName: string
				allianceId: string | null
				allianceName: string | null
			}> = []
			if (item.corporationId && item.corporationName)
				result.push({
					value: item.corporationId,
					label: item.corporationName,
					organizationType: 'corporation',
					corporationId: item.corporationId,
					corporationName: item.corporationName,
					allianceId: item.allianceId,
					allianceName: item.allianceName,
				})
			if (item.allianceId && item.allianceName)
				result.push({
					value: item.allianceId,
					label: item.allianceName,
					organizationType: 'alliance',
					corporationId: item.corporationId ?? item.allianceId,
					corporationName: item.corporationName ?? item.allianceName,
					allianceId: item.allianceId,
					allianceName: item.allianceName,
				})
			return result
		})
		return [...new Map(options.map((option) => [option.value, option])).values()]
	}, [board.data?.items])
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
	const clearFilters = () => {
		setView('next7')
		setTimerTypes([])
		setPriorities([])
		setHostilities([])
		setStructureTypes([])
		setOrganizations([])
		setSystem('')
		setAssignedToMe(false)
		setPage(1)
	}
	const hasActiveFilters = Boolean(
		timerTypes.length ||
			priorities.length ||
			hostilities.length ||
			system ||
			structureTypes.length ||
			organizations.length ||
			assignedToMe
	)

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
				description="Alliance operational timers."
				action={
					canCreate ? (
						<Button onClick={() => setCreating(true)}>
							<Plus />
							New timer
						</Button>
					) : undefined
				}
			/>

			<Card className="mb-6">
				<CardHeader className="pb-0">
					<Tabs
						value={category || 'all'}
						onValueChange={(value) => {
							setCategory(value as TimerboardKindTab)
							setPage(1)
						}}
					>
						<TabsList className="flex h-10 min-h-10 w-full flex-nowrap gap-px overflow-x-auto border-b-0">
							{kindTabs.map((tab) => {
								const Icon = tab.icon
								return (
									<TabsTrigger
										key={tab.value}
										value={tab.value}
										className="group h-10 shrink-0 gap-1.5 px-3"
									>
										<Icon
											className={`h-4 w-4 ${tab.tone ? timerboardTypeToneClasses[tab.tone as keyof typeof timerboardTypeToneClasses] : ''}`}
										/>
										<span className="grid">
											<span
												className="invisible col-start-1 row-start-1 font-bold"
												aria-hidden="true"
											>
												{tab.label}
											</span>
											<span className="col-start-1 row-start-1 font-semibold group-data-[state=active]:font-bold">
												{tab.label}
											</span>
										</span>
									</TabsTrigger>
								)
							})}
						</TabsList>
					</Tabs>
				</CardHeader>
				<CardContent className="space-y-4 pt-4">
					<div className="flex items-center justify-between gap-3">
						<CardTitle className="text-base">Filters</CardTitle>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<SegmentedControl
							options={viewLabels}
							value={view}
							onValueChange={changeView}
							aria-label="Time range filters"
							className="w-full overflow-x-auto sm:w-fit"
						/>
						{hasActiveFilters ? (
							<Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
								Clear Filters
							</Button>
						) : null}
					</div>
					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<FilterField label="Timer type">
							<Select
								options={timerboardTimerTypeOptions}
								values={timerTypes}
								multiple
								renderOption={(option) => {
									const Icon = option.icon
									return (
										<div className="flex items-center gap-2">
											<Icon
												className={`h-4 w-4 shrink-0 ${timerboardTypeToneClasses[option.tone]}`}
											/>
											<span>{option.label}</span>
										</div>
									)
								}}
								onValuesChange={(values) => {
									setTimerTypes(values as TimerType[])
									setPage(1)
								}}
							/>
						</FilterField>
						<FilterField label="Structure type">
							<Select
								options={structureTypeOptions}
								values={structureTypes}
								multiple
								renderOption={(option) => {
									const Icon = option.icon
									return (
										<div className="flex min-w-0 items-center gap-2">
											<Icon className={`h-4 w-4 shrink-0 ${structureToneClasses[option.tone]}`} />
											<span className="truncate">{option.label}</span>
										</div>
									)
								}}
								onValuesChange={(values) => {
									setStructureTypes(values)
									setPage(1)
								}}
							/>
						</FilterField>
						<FilterField label="Organization">
							<Select
								options={organizationOptions}
								values={organizations}
								multiple
								placeholder="Select an option"
								renderOption={(option) => (
									<div className="flex min-w-0 items-center gap-2">
										{option.organizationType === 'alliance' ? (
											<OrganizationLogo
												corporationId={option.corporationId}
												corporationName={option.corporationName}
												allianceId={option.value}
												allianceName={option.label}
												size="md"
											/>
										) : (
											<CorporationLogo
												corporationId={option.value}
												corporationName={option.label}
												size="md"
											/>
										)}
										<span className="truncate">{option.label}</span>
									</div>
								)}
								onValuesChange={(values) => {
									setOrganizations(values)
									setPage(1)
								}}
							/>
						</FilterField>
						<FilterField label="Hostility">
							<Select
								options={filterOptions('All hostilities', TIMERBOARD_HOSTILITIES).slice(1)}
								values={hostilities}
								multiple
								renderOption={(option) => (
									<Badge variant={hostilityVariants[option.value as TimerHostility]}>
										{option.label}
									</Badge>
								)}
								onValuesChange={(values) => {
									setHostilities(values as TimerHostility[])
									setPage(1)
								}}
							/>
						</FilterField>
						<FilterField label="Priority">
							<Select
								options={filterOptions('All priorities', TIMERBOARD_PRIORITIES).slice(1)}
								values={priorities}
								multiple
								renderOption={(option) => (
									<div className="flex items-center gap-2">
										<span
											className={`h-2.5 w-2.5 shrink-0 rounded-full ${priorityStyles[option.value as TimerPriority]}`}
										/>
										<span>{option.label}</span>
									</div>
								)}
								onValuesChange={(values) => {
									setPriorities(values as TimerPriority[])
									setPage(1)
								}}
							/>
						</FilterField>
						<FilterField label="System">
							<Input
								value={system}
								maxLength={120}
								onChange={(event) => {
									setSystem(event.target.value)
									setPage(1)
								}}
								placeholder="Search system"
							/>
						</FilterField>
						<label className="flex w-full cursor-pointer items-center justify-between gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
							<span>Assigned to me</span>
							<Switch
								checked={assignedToMe}
								onCheckedChange={(checked) => {
									setAssignedToMe(checked)
									setPage(1)
								}}
							/>
						</label>
					</div>
				</CardContent>
			</Card>

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

			<Dialog
				open={sheetOpen}
				onOpenChange={(open) => {
					if (!open) closeSheet()
				}}
			>
				<DialogContent className="max-h-[92vh] w-[96vw] max-w-none overflow-y-auto md:w-[50vw] md:max-w-[56rem]">
					<DialogHeader className="mb-1">
						<DialogTitle className="flex items-center gap-2">
							<CalendarClock />
							{creating ? 'New timer' : editingEntry ? 'Edit timer' : 'Timer details'}
						</DialogTitle>
						<DialogDescription>
							{creating || editingEntry
								? 'Enter event times in EVE time or your local system time.'
								: 'Review timer details, ownership, and activity.'}
						</DialogDescription>
					</DialogHeader>
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
				</DialogContent>
			</Dialog>
		</Container>
	)
}
