import {
	Anchor,
	Antenna,
	Building2,
	Castle,
	Circle,
	CircleDot,
	DollarSign,
	Factory,
	House,
	Landmark,
	Moon,
	Pickaxe,
	Shield,
	ShieldAlert,
	Skull,
	TowerControl,
	Unlink,
	UsersRound,
	WandSparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'

import type { LucideIcon } from 'lucide-react'
import type { TimerCategory, TimerHostility, TimerPriority, TimerState, TimerType } from './types'

export type TimerboardStructureOption = {
	value: string
	label: string
	icon: LucideIcon
	tone: 'blue' | 'yellow' | 'green' | 'purple' | 'red' | 'gray'
}

export const timerboardStructureOptions: TimerboardStructureOption[] = [
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

export const structureToneClasses: Record<TimerboardStructureOption['tone'], string> = {
	blue: 'text-sky-300',
	yellow: 'text-amber-300',
	green: 'text-emerald-300',
	purple: 'text-purple-300',
	red: 'text-rose-300',
	gray: 'text-muted-foreground',
}

export const timerboardPriorityStyles: Record<TimerPriority, string> = {
	critical: 'bg-destructive',
	high: 'bg-orange-500',
	normal: 'bg-primary',
	low: 'bg-muted-foreground',
}

export const timerboardHostilityVariants: Record<
	TimerHostility,
	'ghost' | 'success' | 'warning' | 'destructive'
> = {
	friendly: 'success',
	neutral: 'ghost',
	hostile: 'destructive',
	unknown: 'warning',
}

export const timerboardHostilityStyles: Record<TimerHostility, string> = {
	friendly: 'bg-emerald-400',
	neutral: 'bg-muted-foreground',
	hostile: 'bg-destructive',
	unknown: 'bg-amber-400',
}

export const timerboardStateVariants: Record<
	TimerState,
	'ghost' | 'success' | 'warning' | 'destructive'
> = {
	planned: 'ghost',
	covered: 'success',
	completed: 'success',
	cancelled: 'destructive',
}

export type TimerboardTypeOption = {
	value: TimerType
	label: string
	icon: LucideIcon
	tone: 'blue' | 'red' | 'yellow' | 'green' | 'purple' | 'gray'
}

export const timerboardTimerTypeOptions: TimerboardTypeOption[] = [
	{ value: 'reinforcement', label: 'Reinforcement', icon: Shield, tone: 'blue' },
	{ value: 'final', label: 'Final', icon: Skull, tone: 'red' },
	{ value: 'anchoring', label: 'Anchoring', icon: Anchor, tone: 'green' },
	{ value: 'unanchoring', label: 'Unanchoring', icon: Unlink, tone: 'yellow' },
	{ value: 'extraction', label: 'Extraction', icon: Pickaxe, tone: 'purple' },
	{ value: 'custom', label: 'Custom', icon: WandSparkles, tone: 'gray' },
]

export type TimerboardCategoryOption = {
	value: TimerCategory
	label: string
	icon: LucideIcon
	tone: TimerboardTypeOption['tone']
}

export const timerboardCategoryOptions: TimerboardCategoryOption[] = [
	{ value: 'structure', label: 'Structures', icon: Building2, tone: 'blue' },
	{ value: 'sovereignty', label: 'Sovereignty', icon: Landmark, tone: 'purple' },
	{ value: 'skyhook', label: 'Skyhooks', icon: TowerControl, tone: 'green' },
	{ value: 'moon', label: 'Moons', icon: Moon, tone: 'yellow' },
	{ value: 'fleet', label: 'Fleets', icon: UsersRound, tone: 'blue' },
	{ value: 'custom', label: 'Custom', icon: WandSparkles, tone: 'gray' },
]

export const timerboardTypeToneClasses: Record<TimerboardTypeOption['tone'], string> = {
	blue: 'text-sky-300',
	red: 'text-rose-300',
	yellow: 'text-amber-300',
	green: 'text-emerald-300',
	purple: 'text-purple-300',
	gray: 'text-muted-foreground',
}

export function TimerboardTimerType({ type }: { type: TimerType }) {
	const option = timerboardTimerTypeOptions.find((item) => item.value === type)
	if (!option) return <span className="capitalize">{type}</span>
	const Icon = option.icon
	return (
		<span className="flex items-center gap-1.5 capitalize">
			<Icon className={`h-4 w-4 shrink-0 ${timerboardTypeToneClasses[option.tone]}`} />
			{option.label}
		</span>
	)
}

export function TimerboardStructure({
	type,
	name,
	showName = true,
}: {
	type: string | null
	name?: string | null
	showName?: boolean
}) {
	const option = timerboardStructureOptions.find((item) => item.value === type)
	if (!option) return showName && name ? <span>{name}</span> : null
	const Icon = option.icon
	return (
		<span className="flex min-w-0 items-center gap-2">
			<Icon className={cn('h-4 w-4 shrink-0', structureToneClasses[option.tone])} />
			{showName ? <span className="truncate">{name || option.label}</span> : null}
		</span>
	)
}
