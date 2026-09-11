import {
	Anchor,
	Antenna,
	Building2,
	Castle,
	Circle,
	CircleDot,
	DollarSign,
	Factory,
	Globe2,
	House,
	Moon,
	Shield,
	ShieldAlert,
	Stars,
	TowerControl,
	WandSparkles,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import {
	TIMERBOARD_CATEGORIES,
	TIMERBOARD_HOSTILITIES,
	TIMERBOARD_PRIORITIES,
	TIMERBOARD_TYPES,
} from '@repo/core'

import { OrganizationLogo } from '@/components/corporation-logo'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Select } from '@/components/ui/select'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useUserMemberships } from '@/hooks/useGroups'
import {
	useOrganizationSearch,
	useSystemCelestials,
	useSystemSearch,
} from '@/hooks/useLocationSearch'
import { ConflictError } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
	useCreateTimerboardEntry,
	useTimerboardShareDestinations,
	useUpdateTimerboardEntry,
} from '../hooks'
import { parseTimerboardText } from '../timerboard-parser'
import {
	timerboardCategoryOptions,
	timerboardHostilityStyles,
	timerboardPriorityStyles,
	timerboardTimerTypeOptions,
	timerboardTypeToneClasses,
} from '../timerboard-visuals'

import type { FormEvent, ReactNode } from 'react'
import type { SelectOption } from '@/components/ui/select'
import type { EsiLocationSearchResult } from '@/lib/esi-api'
import type {
	CreateTimerboardEntryInput,
	TimerboardEntry,
	TimerCategory,
	TimerHostility,
	TimerPriority,
	TimerType,
} from '../types'

type FormStep = 1 | 2 | 3
type TimeZoneMode = 'utc' | 'local'

type StructureOption = {
	value: string
	label: string
	icon: typeof Building2
	tone: string
	category: TimerCategory
}

type StructureGroup = { label: string; options: StructureOption[] }

type CorporationOption = SelectOption & {
	organizationName: string
	ticker: string | null
	allianceId: string | null
	allianceName: string | null
	allianceTicker: string | null
}

const structureGroups: StructureGroup[] = [
	{
		label: 'Citadels',
		options: [
			{
				value: 'upwell_citadel_keepstar',
				label: 'Keepstar',
				icon: Building2,
				tone: 'blue',
				category: 'structure',
			},
			{
				value: 'upwell_citadel_fortizar',
				label: 'Fortizar',
				icon: Castle,
				tone: 'blue',
				category: 'structure',
			},
			{
				value: 'upwell_citadel_astrahus',
				label: 'Astrahus',
				icon: House,
				tone: 'blue',
				category: 'structure',
			},
		],
	},
	{
		label: 'Engineering complexes',
		options: [
			{
				value: 'upwell_engineering_sotiyo',
				label: 'Sotiyo',
				icon: Factory,
				tone: 'yellow',
				category: 'structure',
			},
			{
				value: 'upwell_engineering_azbel',
				label: 'Azbel',
				icon: Factory,
				tone: 'yellow',
				category: 'structure',
			},
			{
				value: 'upwell_engineering_raitaru',
				label: 'Raitaru',
				icon: Factory,
				tone: 'yellow',
				category: 'structure',
			},
		],
	},
	{
		label: 'Refineries',
		options: [
			{
				value: 'upwell_refinery_tatara',
				label: 'Tatara',
				icon: Factory,
				tone: 'yellow',
				category: 'structure',
			},
			{
				value: 'upwell_refinery_athanor',
				label: 'Athanor',
				icon: Factory,
				tone: 'yellow',
				category: 'structure',
			},
		],
	},
	{
		label: 'Navigation structures',
		options: [
			{
				value: 'ansiblex_jump_bridge',
				label: 'Ansiblex Jump Gate',
				icon: Circle,
				tone: 'green',
				category: 'structure',
			},
			{
				value: 'pharolux_cyno_beacon',
				label: 'Pharolux Cyno Beacon',
				icon: CircleDot,
				tone: 'green',
				category: 'structure',
			},
			{
				value: 'tenebrex_cyno_jammer',
				label: 'Tenebrex Cyno Jammer',
				icon: CircleDot,
				tone: 'green',
				category: 'structure',
			},
		],
	},
	{
		label: 'Sovereignty',
		options: [
			{
				value: 'orbital_skyhook',
				label: 'Orbital Skyhook',
				icon: TowerControl,
				tone: 'purple',
				category: 'skyhook',
			},
			{
				value: 'sovereignty_hub',
				label: 'Sovereignty Hub',
				icon: Shield,
				tone: 'purple',
				category: 'sovereignty',
			},
		],
	},
	{
		label: 'Miscellaneous',
		options: [
			{
				value: 'player_owned_starbase',
				label: 'Starbase (POS)',
				icon: Antenna,
				tone: 'blue',
				category: 'structure',
			},
			{
				value: 'metenox_moon_drill',
				label: 'Metenox Moon Drill',
				icon: Moon,
				tone: 'gray',
				category: 'moon',
			},
			{
				value: 'mercenary_den',
				label: 'Mercenary Den',
				icon: ShieldAlert,
				tone: 'red',
				category: 'structure',
			},
			{
				value: 'customs_office_poco',
				label: 'Customs Office (POCO)',
				icon: DollarSign,
				tone: 'gray',
				category: 'structure',
			},
			{ value: 'custom', label: 'Other / custom', icon: Anchor, tone: 'gray', category: 'custom' },
		],
	},
]

function categoryOptionsForStructureType(structureType: string): TimerCategory[] {
	if (!structureType) return [...TIMERBOARD_CATEGORIES]
	switch (structureType) {
		case 'sovereignty_hub':
			return ['sovereignty']
		case 'orbital_skyhook':
			return ['skyhook']
		case 'upwell_refinery_tatara':
		case 'upwell_refinery_athanor':
		case 'metenox_moon_drill':
			return ['structure', 'fleet', 'moon', 'custom']
		case 'custom':
			return ['fleet', 'custom']
		default:
			return ['structure', 'fleet', 'custom']
	}
}

function timerTypeOptionsForStructureType(structureType: string): TimerType[] {
	const extractionStructures = new Set([
		'upwell_refinery_tatara',
		'upwell_refinery_athanor',
		'orbital_skyhook',
		'metenox_moon_drill',
		'mercenary_den',
		'customs_office_poco',
		'custom',
	])
	return extractionStructures.has(structureType)
		? [...TIMERBOARD_TYPES]
		: TIMERBOARD_TYPES.filter((value) => value !== 'extraction')
}

const kindToneClasses: Record<string, { active: string; inactive: string }> = {
	blue: {
		active: '!border-2 !border-sky-300 bg-sky-500/20 text-sky-100 ring-1 ring-sky-300/40',
		inactive: '!border-sky-400/70 text-sky-300/90 hover:!border-sky-300 hover:bg-sky-500/10',
	},
	purple: {
		active:
			'!border-2 !border-purple-300 bg-purple-500/20 text-purple-100 ring-1 ring-purple-300/40',
		inactive:
			'!border-purple-400/70 text-purple-300/90 hover:!border-purple-300 hover:bg-purple-500/10',
	},
	green: {
		active:
			'!border-2 !border-emerald-300 bg-emerald-500/20 text-emerald-100 ring-1 ring-emerald-300/40',
		inactive:
			'!border-emerald-400/70 text-emerald-300/90 hover:!border-emerald-300 hover:bg-emerald-500/10',
	},
	yellow: {
		active: '!border-2 !border-amber-300 bg-amber-500/20 text-amber-100 ring-1 ring-amber-300/40',
		inactive:
			'!border-amber-400/70 text-amber-300/90 hover:!border-amber-300 hover:bg-amber-500/10',
	},
	red: {
		active: '!border-2 !border-rose-300 bg-rose-500/20 text-rose-100 ring-1 ring-rose-300/40',
		inactive: '!border-rose-400/70 text-rose-300/90 hover:!border-rose-300 hover:bg-rose-500/10',
	},
	gray: {
		active:
			'!border-2 !border-muted-foreground bg-muted/40 text-foreground ring-1 ring-muted-foreground/40',
		inactive:
			'!border-muted-foreground/70 text-muted-foreground hover:!border-muted-foreground hover:bg-muted/30',
	},
}

const stepOptions = [
	{ value: '1', label: 'When' },
	{ value: '2', label: 'What' },
	{ value: '3', label: 'Where & Who' },
] as const

const selectOptions = (values: readonly string[]): SelectOption[] =>
	values.map((value) => ({ value, label: `${value[0]?.toUpperCase()}${value.slice(1)}` }))

function formatDateTimeInput(value: string | null | undefined, timeZone: TimeZoneMode): string {
	if (!value) return ''
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	const year = timeZone === 'utc' ? date.getUTCFullYear() : date.getFullYear()
	const month = (timeZone === 'utc' ? date.getUTCMonth() : date.getMonth()) + 1
	const day = timeZone === 'utc' ? date.getUTCDate() : date.getDate()
	const hours = timeZone === 'utc' ? date.getUTCHours() : date.getHours()
	const minutes = timeZone === 'utc' ? date.getUTCMinutes() : date.getMinutes()
	return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
		.toString()
		.padStart(2, '0')}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
}

function parseDateTimeInput(value: string, timeZone: TimeZoneMode): string | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
	if (!match) return null
	const [year, month, day, hours, minutes] = match.slice(1).map(Number)
	const date =
		timeZone === 'utc'
			? new Date(Date.UTC(year, month - 1, day, hours, minutes))
			: new Date(year, month - 1, day, hours, minutes)
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function StepPanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-4 rounded-lg border border-border/60 bg-muted/10 p-4">
			<h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
				{title}
			</h3>
			{children}
		</section>
	)
}

function structureButtonClass(option: { tone: string }, active: boolean): string {
	const tone = kindToneClasses[option.tone]
	return cn(
		'flex h-auto min-h-11 items-center justify-start gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors',
		active ? tone.active : cn('border-border bg-background', tone.inactive)
	)
}

function mapSystemOption(system: EsiLocationSearchResult): SelectOption {
	return { value: system.systemId, label: system.systemName, description: system.regionName }
}

export function TimerboardForm({
	entry,
	onSaved,
	onCancel,
}: {
	entry?: TimerboardEntry
	onSaved: (entry: TimerboardEntry) => void
	onCancel: () => void
}) {
	const createEntry = useCreateTimerboardEntry()
	const updateEntry = useUpdateTimerboardEntry()
	const isEditing = Boolean(entry)
	const [step, setStep] = useState<FormStep>(1)
	const [rawText, setRawText] = useState('')
	const [timePreset, setTimePreset] = useState('')
	const [timeZone, setTimeZone] = useState<TimeZoneMode>('utc')
	const [title, setTitle] = useState(entry?.title ?? '')
	const [structureType, setStructureType] = useState(entry?.subjectType ?? '')
	const initialCategoryOptions = categoryOptionsForStructureType(entry?.subjectType ?? '')
	const initialTimerTypeOptions = timerTypeOptionsForStructureType(entry?.subjectType ?? '')
	const [category, setCategory] = useState<TimerCategory>(() =>
		entry && initialCategoryOptions.includes(entry.category)
			? entry.category
			: initialCategoryOptions.includes('custom')
				? 'custom'
				: (initialCategoryOptions[0] ?? 'custom')
	)
	const [timerType, setTimerType] = useState<TimerType>(() =>
		entry && initialTimerTypeOptions.includes(entry.timerType) ? entry.timerType : 'custom'
	)
	const [priority, setPriority] = useState<TimerPriority>(entry?.priority ?? 'normal')
	const [hostility, setHostility] = useState<TimerHostility>(entry?.hostility ?? 'unknown')
	const [startsAt, setStartsAt] = useState(formatDateTimeInput(entry?.startsAt, 'utc'))
	const [systemName, setSystemName] = useState(entry?.systemName ?? '')
	const [systemId, setSystemId] = useState(entry?.systemId ?? '')
	const [regionId, setRegionId] = useState(entry?.regionId ?? '')
	const [regionName, setRegionName] = useState(entry?.regionName ?? '')
	const [planetId, setPlanetId] = useState(entry?.planetId ?? '')
	const [planetName, setPlanetName] = useState(entry?.planetName ?? '')
	const [moonId, setMoonId] = useState(entry?.moonId ?? '')
	const [moonName, setMoonName] = useState(entry?.moonName ?? '')
	const [corporationId, setCorporationId] = useState(entry?.corporationId ?? '')
	const [corporationName, setCorporationName] = useState(entry?.corporationName ?? '')
	const [corporationTicker, setCorporationTicker] = useState<string | null>(null)
	const [allianceId, setAllianceId] = useState(entry?.allianceId ?? '')
	const [allianceName, setAllianceName] = useState(entry?.allianceName ?? '')
	const [corporationQuery, setCorporationQuery] = useState(entry?.corporationName ?? '')
	const [strictCorporationSearch, setStrictCorporationSearch] = useState(false)
	const [notes, setNotes] = useState(entry?.notes ?? '')
	const [clientError, setClientError] = useState<string | null>(null)
	const [conflict, setConflict] = useState<TimerboardEntry | null>(null)
	const [expectedVersion, setExpectedVersion] = useState(entry?.version ?? 1)
	const systemSearch = useSystemSearch(systemName, step === 3)
	const systemCelestials = useSystemCelestials(systemId, step === 3)
	const organizationSearch = useOrganizationSearch(
		corporationQuery,
		step === 3,
		strictCorporationSearch
	)
	const { data: memberships = [] } = useUserMemberships()
	const { data: shareDestinations = [] } = useTimerboardShareDestinations()
	const [visibilityGroupIds, setVisibilityGroupIds] = useState<string[]>(
		entry?.visibilityGroupIds ?? []
	)
	const [sharingEnabled, setSharingEnabled] = useState(entry?.sharingEnabled ?? true)
	const [selectedShareDestinations, setSelectedShareDestinations] = useState<string[]>(
		(entry?.shareDestinations ?? []).map(
			(destination) => `${destination.adapterKey}:${destination.targetKey}`
		)
	)
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const mutation = entry ? updateEntry : createEntry
	const allowedCategoryValues = categoryOptionsForStructureType(structureType)
	const allowedTimerTypeValues = timerTypeOptionsForStructureType(structureType)
	const allowedCategoryOptions = timerboardCategoryOptions.filter((option) =>
		allowedCategoryValues.includes(option.value as TimerCategory)
	)

	const systemOptions = useMemo(() => {
		const options = (systemSearch.data ?? []).map(mapSystemOption)
		if (systemId && systemName && !options.some((option) => option.value === systemId)) {
			options.unshift({ value: systemId, label: systemName })
		}
		return options
	}, [systemId, systemName, systemSearch.data])
	const celestialOptions = useMemo(
		() => [
			...(systemCelestials.data?.planets ?? []).map((planet) => ({
				value: `planet:${planet.id}`,
				label: planet.name,
				description: 'Planet',
			})),
			...(systemCelestials.data?.moons ?? []).map((moon) => ({
				value: `moon:${moon.id}`,
				label: moon.name,
				description: 'Moon',
			})),
		],
		[systemCelestials.data]
	)
	const selectedCelestial = planetId ? `planet:${planetId}` : moonId ? `moon:${moonId}` : ''
	const corporationOptions = useMemo<CorporationOption[]>(() => {
		const options = (organizationSearch.data ?? [])
			.filter((result) => result.type === 'corporation')
			.map((result) => ({
				value: result.id,
				label: `${result.name}${result.ticker ? ` [${result.ticker}]` : ''}`,
				organizationName: result.name,
				ticker: result.ticker ?? null,
				allianceId: result.parentAlliance?.id ?? null,
				allianceName: result.parentAlliance?.name ?? null,
				allianceTicker: result.parentAlliance?.ticker ?? null,
			}))
		if (corporationId && !options.some((option) => option.value === corporationId)) {
			options.unshift({
				value: corporationId,
				label: `${corporationName || corporationId}${corporationTicker ? ` [${corporationTicker}]` : ''}`,
				organizationName: corporationName || corporationId,
				ticker: corporationTicker,
				allianceId: allianceId || null,
				allianceName: allianceName || null,
				allianceTicker: null,
			})
		}
		return options
	}, [corporationId, corporationName, corporationTicker, organizationSearch.data])

	const loadConflict = () => {
		if (!conflict) return
		setTitle(conflict.title)
		const conflictStructureType = conflict.subjectType ?? ''
		const conflictCategoryOptions = categoryOptionsForStructureType(conflictStructureType)
		const conflictTimerTypeOptions = timerTypeOptionsForStructureType(conflictStructureType)
		setStructureType(conflictStructureType)
		setTimerType(
			conflictTimerTypeOptions.includes(conflict.timerType) ? conflict.timerType : 'custom'
		)
		setCategory(
			conflictCategoryOptions.includes(conflict.category)
				? conflict.category
				: (conflictCategoryOptions[0] ?? 'custom')
		)
		setPriority(conflict.priority)
		setHostility(conflict.hostility)
		setStartsAt(formatDateTimeInput(conflict.startsAt, timeZone))
		setSystemName(conflict.systemName ?? '')
		setSystemId(conflict.systemId ?? '')
		setRegionId(conflict.regionId ?? '')
		setRegionName(conflict.regionName ?? '')
		setPlanetId(conflict.planetId ?? '')
		setPlanetName(conflict.planetName ?? '')
		setMoonId(conflict.moonId ?? '')
		setMoonName(conflict.moonName ?? '')
		setCorporationId(conflict.corporationId ?? '')
		setCorporationName(conflict.corporationName ?? '')
		setCorporationQuery(conflict.corporationName ?? '')
		setAllianceId(conflict.allianceId ?? '')
		setAllianceName(conflict.allianceName ?? '')
		setNotes(conflict.notes ?? '')
		setVisibilityGroupIds(conflict.visibilityGroupIds ?? [])
		setSharingEnabled(conflict.sharingEnabled ?? false)
		setSelectedShareDestinations(
			(conflict.shareDestinations ?? []).map(
				(destination) => `${destination.adapterKey}:${destination.targetKey}`
			)
		)
		setExpectedVersion(conflict.version)
		setConflict(null)
	}

	const parsePastedText = () => {
		const parsed = parseTimerboardText(rawText)
		if (!parsed) {
			setClientError(
				'Could not find a reinforcement date. Use text such as “Reinforced until 2026.09.12 20:30:00”.'
			)
			return
		}
		setStartsAt(formatDateTimeInput(parsed.eventAt, timeZone))
		if (parsed.title) setTitle(parsed.title)
		if (parsed.systemName) setSystemName(parsed.systemName)
		if (parsed.event) setTimerType(parsed.event === 'reinforced' ? 'reinforcement' : parsed.event)
		setClientError(null)
	}

	const selectTimePreset = (hours: number) => {
		const start = new Date()
		start.setTime(start.getTime() + hours * 60 * 60 * 1000)
		start.setSeconds(0, 0)
		setStartsAt(formatDateTimeInput(start.toISOString(), timeZone))
	}

	const changeTimeZone = (nextTimeZone: TimeZoneMode) => {
		if (nextTimeZone === timeZone) return
		const instant = parseDateTimeInput(startsAt, timeZone)
		setTimeZone(nextTimeZone)
		if (instant) setStartsAt(formatDateTimeInput(instant, nextTimeZone))
	}

	const nextStep = () => {
		setClientError(null)
		if (step === 1 && !startsAt) {
			setClientError('Choose an event time before continuing.')
			return
		}
		if (step === 2 && !title.trim()) {
			setClientError('Add a short title before continuing.')
			return
		}
		setStep((current) => Math.min(3, current + 1) as FormStep)
	}

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault()
		setClientError(null)
		if (step < 3) {
			nextStep()
			return
		}
		if (!startsAt) return setClientError('Event time is required.')
		if (!title.trim()) return setClientError('Title is required.')
		const normalizedStart = parseDateTimeInput(startsAt, timeZone)
		if (!normalizedStart) return setClientError('Enter a valid event time.')
		const input: CreateTimerboardEntryInput = {
			category,
			timerType,
			title: title.trim(),
			priority,
			hostility,
			startsAt: normalizedStart,
			systemId: systemId.trim() || null,
			systemName: systemName.trim() || null,
			regionId: regionId.trim() || null,
			regionName: regionName.trim() || null,
			planetId: planetId.trim() || null,
			planetName: planetName.trim() || null,
			moonId: moonId.trim() || null,
			moonName: moonName.trim() || null,
			corporationId: corporationId.trim() || null,
			corporationName: corporationName.trim() || null,
			allianceId: allianceId.trim() || null,
			allianceName: allianceName.trim() || null,
			subjectId: null,
			subjectType: structureType.trim() || null,
			subjectName: null,
			notes: notes.trim() || null,
			visibilityGroupIds,
			sharingEnabled,
			shareDestinations: shareDestinations.filter((destination) =>
				selectedShareDestinations.includes(`${destination.adapterKey}:${destination.targetKey}`)
			),
		}
		try {
			const saved = entry
				? await updateEntry.mutateAsync({ entryId: entry.id, input: { ...input, expectedVersion } })
				: await createEntry.mutateAsync(input)
			onSaved(saved)
		} catch (error) {
			if (error instanceof ConflictError && error.current)
				setConflict(error.current as TimerboardEntry)
		}
	}

	return (
		<form className="space-y-4" onSubmit={handleSubmit}>
			<SegmentedControl
				options={stepOptions}
				value={String(step) as (typeof stepOptions)[number]['value']}
				onValueChange={(value) => setStep(Number(value) as FormStep)}
				aria-label="Timer steps"
				className="w-full [&>button]:flex-1"
			/>
			{conflict ? (
				<div className="rounded-md border border-warning/50 bg-warning/10 p-3" role="alert">
					<p className="font-medium">This timer changed while you were editing.</p>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="mt-2"
						onClick={loadConflict}
					>
						Load latest version
					</Button>
				</div>
			) : null}
			{clientError ? (
				<p className="text-sm text-destructive" role="alert">
					{clientError}
				</p>
			) : null}
			{mutation.error && !conflict ? (
				<p className="text-sm text-destructive" role="alert">
					{mutation.error.message}
				</p>
			) : null}

			{step === 1 && (
				<StepPanel title="When">
					{!isEditing ? (
						<div className="space-y-2">
							<FilterField label="Paste reinforcement text (optional)">
								<textarea
									className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
									value={rawText}
									onChange={(event) => setRawText(event.target.value)}
									placeholder="Reinforced until 2026.09.12 20:30:00 (1DQ1-A)"
								/>
							</FilterField>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								showIcon={false}
								onClick={parsePastedText}
							>
								<WandSparkles /> Parse text
							</Button>
						</div>
					) : null}
					<div className="flex flex-wrap items-end gap-3">
						<FilterField label="Quick time">
							<SegmentedControl
								options={[
									{ value: '1', label: 'In 1h' },
									{ value: '2', label: 'In 2h' },
									{ value: '4', label: 'In 4h' },
									{ value: '8', label: 'In 8h' },
									{ value: '12', label: 'In 12h' },
									{ value: '24', label: 'In 24h' },
								]}
								value={timePreset}
								onValueChange={(value) => {
									setTimePreset(value)
									selectTimePreset(Number(value))
								}}
								aria-label="Quick time"
								className="min-w-0 flex-1 [&>button]:flex-1 [&>button]:px-2 sm:flex-none"
							/>
						</FilterField>
						<FilterField label="Time zone" className="ml-auto">
							<SegmentedControl
								options={
									[
										{ value: 'utc', label: 'EVE' },
										{ value: 'local', label: 'Local' },
									] as const
								}
								value={timeZone}
								onValueChange={changeTimeZone}
								aria-label="Time zone"
								className="w-fit"
							/>
						</FilterField>
					</div>
					<FilterField label="Event time">
						<Input
							aria-label="Event time"
							required
							type="datetime-local"
							className="cursor-pointer"
							value={startsAt}
							onChange={(event) => setStartsAt(event.target.value)}
							onClick={(event) => event.currentTarget.showPicker?.()}
						/>
					</FilterField>
				</StepPanel>
			)}

			{step === 2 && (
				<StepPanel title="What">
					<FilterField label="Structure type">
						<div className="space-y-4 rounded-lg border border-border/60 bg-muted/10 p-3">
							{structureGroups.map((group) => (
								<div key={group.label} className="space-y-2">
									<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
										{group.label}
									</div>
									<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
										{group.options.map((option) => {
											const Icon = option.icon
											const active = structureType === option.value
											return (
												<Button
													key={option.value}
													type="button"
													variant="ghost"
													size="sm"
													showIcon={false}
													className={structureButtonClass(option, active)}
													aria-pressed={active}
													onClick={() => {
														setStructureType(option.value)
														setCategory(
															categoryOptionsForStructureType(option.value)[0] ?? option.category
														)
														setTimerType(
															timerTypeOptionsForStructureType(option.value).includes(timerType)
																? timerType
																: 'custom'
														)
													}}
												>
													<Icon className="h-4 w-4" />
													{option.label}
												</Button>
											)
										})}
									</div>
								</div>
							))}
						</div>
					</FilterField>
					<div className="grid gap-4 sm:grid-cols-2">
						<FilterField label="Timer category">
							<Select
								options={allowedCategoryOptions}
								value={category}
								disabled={allowedCategoryValues.length === 1}
								selectedValueAdornment={(option) => {
									const Icon = option.icon
									return <Icon className={`h-4 w-4 ${timerboardTypeToneClasses[option.tone]}`} />
								}}
								inputClassName="pl-10"
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
								onValueChange={(value) => {
									if (allowedCategoryValues.includes(value as TimerCategory))
										setCategory(value as TimerCategory)
								}}
							/>
						</FilterField>
						<FilterField label="Timer type">
							<Select
								options={timerboardTimerTypeOptions.filter((option) =>
									allowedTimerTypeValues.includes(option.value as TimerType)
								)}
								value={timerType}
								selectedValueAdornment={(option) => {
									const Icon = option.icon
									return <Icon className={`h-4 w-4 ${timerboardTypeToneClasses[option.tone]}`} />
								}}
								inputClassName="pl-10"
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
								onValueChange={(value) => {
									if (allowedTimerTypeValues.includes(value as TimerType))
										setTimerType(value as TimerType)
								}}
							/>
						</FilterField>
					</div>
					<FilterField label="Title">
						<Input
							aria-label="Title"
							required
							maxLength={160}
							value={title}
							onChange={(event) => setTitle(event.target.value)}
							placeholder="Structure or operation"
						/>
					</FilterField>
				</StepPanel>
			)}

			{step === 3 && (
				<StepPanel title="Where and Who">
					<div className="grid gap-4 sm:grid-cols-2">
						<FilterField label="System">
							<Select
								options={systemOptions}
								value={systemId}
								query={systemName}
								inputId="timerboard-system"
								aria-label="System"
								selectedValueAdornment={() => (
									<Stars className="h-4 w-4 shrink-0 text-purple-300" />
								)}
								inputClassName={systemId ? 'pl-10' : undefined}
								renderOption={(option) => (
									<div className="flex min-w-0 items-center gap-2">
										<Stars className="h-4 w-4 shrink-0 text-purple-300" />
										<div className="min-w-0">
											<div className="truncate">{option.label}</div>
											{option.description && (
												<div className="truncate text-xs text-muted-foreground">
													{option.description}
												</div>
											)}
										</div>
									</div>
								)}
								onQueryChange={(value) => {
									setSystemName(value)
									if (value.trim().toLowerCase() !== systemName.trim().toLowerCase())
										setSystemId('')
									if (value.trim().toLowerCase() !== systemName.trim().toLowerCase()) {
										setRegionId('')
										setRegionName('')
										setPlanetId('')
										setPlanetName('')
										setMoonId('')
										setMoonName('')
									}
								}}
								searchable
								placeholder="Search solar systems…"
								minQueryLength={3}
								loading={systemSearch.isLoading || systemSearch.isDebouncing}
								onValueChange={(_value, option) => {
									if (option) {
										setSystemId(option.value)
										setSystemName(option.label)
										setPlanetId('')
										setPlanetName('')
										setMoonId('')
										setMoonName('')
										setRegionName(option.description ?? '')
										setRegionId(
											systemSearch.data?.find((system) => system.systemId === option.value)
												?.regionId ?? ''
										)
									}
								}}
								emptyText="No matching solar systems"
								queryHintText="Type at least 3 characters"
							/>
						</FilterField>
						<FilterField label="Celestial">
							<Select
								options={celestialOptions}
								value={selectedCelestial}
								aria-label="Celestial"
								selectedValueAdornment={(option) =>
									option.value.startsWith('moon:') ? (
										<Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
									) : (
										<Globe2 className="h-4 w-4 shrink-0 text-sky-300" />
									)
								}
								renderOption={(option) => {
									const isMoon = option.value.startsWith('moon:')
									return (
										<div className="flex items-center gap-2">
											{isMoon ? (
												<Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
											) : (
												<Globe2 className="h-4 w-4 shrink-0 text-sky-300" />
											)}
											<span>{option.label}</span>
										</div>
									)
								}}
								inputClassName={selectedCelestial ? 'pl-10' : undefined}
								searchable
								disabled={!systemId}
								loading={systemCelestials.isLoading}
								placeholder={systemId ? 'Select a planet or moon…' : 'Select a system first'}
								emptyText="No celestials found"
								onValueChange={(value, option) => {
									const [type, id] = value.split(':')
									setPlanetId(type === 'planet' ? id : '')
									setPlanetName(type === 'planet' ? (option?.label ?? '') : '')
									setMoonId(type === 'moon' ? id : '')
									setMoonName(type === 'moon' ? (option?.label ?? '') : '')
								}}
							/>
						</FilterField>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<FilterField
							label={
								<span className="flex items-center justify-between">
									<span>Corporation</span>
									<label className="flex cursor-pointer items-center gap-1.5 normal-case tracking-normal">
										<Checkbox
											checked={strictCorporationSearch}
											onCheckedChange={(checked) => setStrictCorporationSearch(checked === true)}
											aria-label="Use exact corporation search"
										/>
										<span className="text-xs">Exact</span>
									</label>
								</span>
							}
						>
							<Select
								options={corporationOptions}
								value={corporationId}
								query={corporationQuery}
								aria-label="Corporation"
								renderOption={(option) => (
									<div className="flex min-w-0 items-center gap-2">
										<OrganizationLogo
											corporationId={option.value}
											corporationName={option.label}
											allianceId={option.allianceId}
											allianceName={option.allianceName}
											size="lg"
										/>
										<div className="min-w-0">
											<div className="truncate" title={option.label}>
												<span className="font-medium">{option.organizationName}</span>
												{option.ticker && (
													<span className="text-muted-foreground"> [{option.ticker}]</span>
												)}
											</div>
											{option.allianceName && (
												<div
													className="truncate text-xs text-muted-foreground"
													title={`${option.allianceName}${option.allianceTicker ? ` [${option.allianceTicker}]` : ''}`}
												>
													<span className="font-medium">{option.allianceName}</span>
													{option.allianceTicker && <span> [{option.allianceTicker}]</span>}
												</div>
											)}
										</div>
									</div>
								)}
								selectedValueAdornment={(option) => (
									<OrganizationLogo
										corporationId={option.value}
										corporationName={option.organizationName}
										allianceId={option.allianceId}
										allianceName={option.allianceName}
										size="sm"
									/>
								)}
								renderSelectedValue={(option) => (
									<div className="truncate">
										<span className="font-medium">{option.organizationName}</span>
										{option.ticker && (
											<span className="text-muted-foreground"> [{option.ticker}]</span>
										)}
									</div>
								)}
								inputClassName={corporationId ? 'pl-10' : undefined}
								onQueryChange={(value) => {
									setCorporationQuery(value)
									if (value.trim().toLowerCase() !== corporationName.trim().toLowerCase()) {
										setCorporationId('')
										setCorporationName('')
										setCorporationTicker(null)
										setAllianceId('')
										setAllianceName('')
									}
								}}
								searchable
								minQueryLength={2}
								contentClassName="sm:min-w-[26rem]"
								listMaxHeight="28rem"
								onSearch={() => void organizationSearch.refetch()}
								loading={organizationSearch.isLoading || organizationSearch.isDebouncing}
								placeholder="Search corporations…"
								emptyText="No matching corporations"
								queryHintText="Type at least 2 characters"
								onValueChange={(value, option) => {
									const result = (organizationSearch.data ?? []).find((item) => item.id === value)
									if (!result || !option) return
									setCorporationId(result.id)
									setCorporationName(result.name)
									setCorporationTicker(result.ticker)
									setCorporationQuery('')
									setAllianceId(result.parentAlliance?.id ?? '')
									setAllianceName(result.parentAlliance?.name ?? '')
								}}
							/>
						</FilterField>
						<FilterField label="Hostility">
							<Select
								options={selectOptions(TIMERBOARD_HOSTILITIES)}
								value={hostility}
								selectedValueAdornment={() => (
									<span
										className={`block h-2.5 w-2.5 shrink-0 rounded-full ${timerboardHostilityStyles[hostility]}`}
									/>
								)}
								inputClassName="pl-10"
								renderOption={(option) => (
									<div className="flex items-center gap-2">
										<span
											className={`h-2.5 w-2.5 shrink-0 rounded-full ${timerboardHostilityStyles[option.value as TimerHostility]}`}
										/>
										<span>{option.label}</span>
									</div>
								)}
								onValueChange={(value) => setHostility(value as TimerHostility)}
							/>
						</FilterField>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<FilterField label="Priority">
							<Select
								options={selectOptions(TIMERBOARD_PRIORITIES)}
								value={priority}
								selectedValueAdornment={() => (
									<span
										className={`block h-2.5 w-2.5 shrink-0 rounded-full ${timerboardPriorityStyles[priority]}`}
									/>
								)}
								inputClassName="pl-10"
								renderOption={(option) => (
									<div className="flex items-center gap-2">
										<span
											className={`h-2.5 w-2.5 shrink-0 rounded-full ${timerboardPriorityStyles[option.value as TimerPriority]}`}
										/>
										<span>{option.label}</span>
									</div>
								)}
								onValueChange={(value) => setPriority(value as TimerPriority)}
							/>
						</FilterField>
					</div>
					<FilterField label="Visibility groups (optional)">
						<Select
							multiple
							searchable
							options={memberships.map((membership) => ({
								value: membership.groupId,
								label: membership.groupName,
								description: membership.categoryName,
							}))}
							values={visibilityGroupIds}
							onValuesChange={(values) => {
								if (values.length > 0 && visibilityGroupIds.length === 0) {
									requestConfirmation({
										title: 'Restrict timer visibility?',
										description:
											'This timer will be visible only to members of the selected groups here. Partner timerboards do not enforce these visibility restrictions, so shared copies may be visible to their audiences.',
										confirmLabel: 'Restrict visibility',
										onConfirm: () => setVisibilityGroupIds(values),
									})
									return
								}
								setVisibilityGroupIds(values)
							}}
							placeholder="Visible to everyone unless groups are selected"
							emptyText="No group memberships found"
						/>
					</FilterField>
					{shareDestinations.length > 0 ? (
						<label className="flex items-center gap-2 text-sm text-muted-foreground">
							<input
								type="checkbox"
								checked={sharingEnabled}
								onChange={(event) => setSharingEnabled(event.target.checked)}
							/>
							Share with partner timerboards
						</label>
					) : null}
					{sharingEnabled && shareDestinations.length > 0 ? (
						<FilterField label="Partner destinations">
							<Select
								multiple
								options={shareDestinations.map((destination) => ({
									value: `${destination.adapterKey}:${destination.targetKey}`,
									label: destination.label,
									description: destination.description ?? undefined,
								}))}
								values={selectedShareDestinations}
								onValuesChange={setSelectedShareDestinations}
								placeholder="Select partner timerboards"
							/>
						</FilterField>
					) : null}
					<FilterField label="Notes (plaintext)">
						<textarea
							className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
							rows={4}
							maxLength={2000}
							value={notes}
							onChange={(event) => setNotes(event.target.value)}
						/>
					</FilterField>
				</StepPanel>
			)}

			<div className="flex justify-between gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={step === 1 ? onCancel : () => setStep((current) => (current - 1) as FormStep)}
				>
					{step === 1 ? 'Cancel' : 'Back'}
				</Button>
				{step < 3 ? (
					<Button
						type="button"
						onClick={(event) => {
							event.preventDefault()
							nextStep()
						}}
					>
						Continue
					</Button>
				) : (
					<Button type="submit" disabled={mutation.isPending}>
						{mutation.isPending ? 'Saving…' : isEditing ? 'Save changes' : 'Create timer'}
					</Button>
				)}
			</div>
			{confirmationDialog}
		</form>
	)
}
