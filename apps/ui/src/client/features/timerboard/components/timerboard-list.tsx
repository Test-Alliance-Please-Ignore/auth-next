import { Globe2, Moon, Orbit, Stars } from 'lucide-react'

import { OrganizationLogo } from '@/components/corporation-logo'
import { DataTable } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { DurationDisplay } from '@/components/ui/duration-display'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { formatDurationBetween } from '@/lib/duration-utils'
import { characterPortraitUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

import {
	timerboardHostilityVariants,
	timerboardPriorityStyles,
	timerboardStateVariants,
	TimerboardStructure,
} from '../timerboard-visuals'

import type { DataTableColumn } from '@/components/data-table'
import type { TimerboardEntry } from '../types'

interface TimerboardListProps {
	entries: TimerboardEntry[]
	nowMs: number
	isLoading?: boolean
	error?: string | null
	onSelect?: (entry: TimerboardEntry) => void
}

export function TimerboardList({
	entries,
	nowMs,
	isLoading = false,
	error,
	onSelect,
}: TimerboardListProps) {
	const columns: Array<DataTableColumn<TimerboardEntry>> = [
		{
			id: 'timer',
			header: 'Timer',
			className: 'min-w-64 max-w-md',
			cell: (entry) => (
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span
							className={cn(
								'h-2.5 w-2.5 shrink-0 rounded-full',
								timerboardPriorityStyles[entry.priority]
							)}
							aria-label={`${entry.priority} priority`}
						/>
						<span className="truncate font-medium" title={entry.title}>
							{entry.title}
						</span>
					</div>
					<div className="mt-1 truncate text-xs text-muted-foreground">
						{entry.subjectName || entry.category}
					</div>
				</div>
			),
		},
		{
			id: 'when',
			header: 'When',
			className: 'whitespace-nowrap',
			cell: (entry) => {
				const isOverdue =
					Date.parse(entry.startsAt) < nowMs && ['planned', 'covered'].includes(entry.state)
				return (
					<div>
						<div className={cn('font-medium', isOverdue && 'text-destructive')}>
							{isOverdue ? (
								<>Overdue · {formatDurationBetween(entry.startsAt, nowMs, { maxUnits: 2 })}</>
							) : (
								<>
									In{' '}
									<DurationDisplay endDate={entry.startsAt} referenceTimeMs={nowMs} maxUnits={2} />
								</>
							)}
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							<EveTimeDisplay dateStr={entry.startsAt} format="compact" />
						</div>
					</div>
				)
			},
		},
		{
			id: 'structure',
			header: 'Structure',
			className: 'max-w-xs',
			cell: (entry) => (
				<div className="min-w-0 text-sm">
					<TimerboardStructure type={entry.subjectType} name={entry.subjectName} />
				</div>
			),
		},
		{
			id: 'location',
			header: 'Location',
			className: 'max-w-xs',
			cell: (entry) => (
				<div className="min-w-0 text-sm">
					<div className="flex items-center gap-1.5 truncate" title={entry.systemName ?? undefined}>
						<Stars className="h-3.5 w-3.5 shrink-0 text-purple-300" />
						{entry.systemName || 'Unknown system'}
					</div>
					{entry.moonName || entry.planetName ? (
						<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
							{entry.moonName ? (
								<Moon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							) : (
								<Globe2 className="h-3.5 w-3.5 shrink-0 text-sky-300" />
							)}
							{entry.moonName ? `Moon ${entry.moonName}` : entry.planetName}
						</div>
					) : null}
					{entry.regionName ? (
						<div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
							{entry.regionName}
						</div>
					) : null}
				</div>
			),
		},
		{
			id: 'organization',
			header: 'Organization',
			className: 'min-w-56 max-w-sm',
			cell: (entry) =>
				entry.corporationId || entry.corporationName ? (
					<div className="flex min-w-0 items-center gap-2">
						<OrganizationLogo
							corporationId={entry.corporationId ?? '0'}
							corporationName={entry.corporationName}
							allianceId={entry.allianceId}
							allianceName={entry.allianceName}
							size="lg"
						/>
						<div className="min-w-0">
							<div className="truncate font-semibold" title={entry.corporationName ?? undefined}>
								{entry.corporationName || 'Unknown corporation'}
								{entry.corporationTicker ? (
									<span className="font-normal text-muted-foreground">
										{' '}
										[{entry.corporationTicker}]
									</span>
								) : null}
							</div>
							{entry.allianceName ? (
								<div className="truncate text-xs text-muted-foreground" title={entry.allianceName}>
									<span className="font-semibold">{entry.allianceName}</span>
									{entry.allianceTicker ? (
										<span className="font-normal"> [{entry.allianceTicker}]</span>
									) : null}
								</div>
							) : null}
						</div>
					</div>
				) : (
					<span className="text-sm text-muted-foreground">Unassigned</span>
				),
		},
		{
			id: 'details',
			header: 'Details',
			className: 'whitespace-nowrap',
			cell: (entry) => (
				<div className="flex flex-col items-start gap-1">
					<Badge variant={timerboardHostilityVariants[entry.hostility]} className="capitalize">
						{entry.hostility}
					</Badge>
					<Badge variant={timerboardStateVariants[entry.state]} className="capitalize">
						{entry.state}
					</Badge>
				</div>
			),
		},
		{
			id: 'owner',
			header: 'Owner',
			className: 'max-w-48 truncate text-sm',
			cell: (entry) =>
				entry.assignedCharacterId && entry.assignedCharacterName ? (
					<div className="flex min-w-0 items-center gap-2">
						<img
							src={characterPortraitUrl(entry.assignedCharacterId, 32)}
							alt=""
							className="h-7 w-7 shrink-0 rounded-full"
							loading="lazy"
						/>
						<span className="truncate">{entry.assignedCharacterName}</span>
					</div>
				) : (
					<span className="text-muted-foreground">Unassigned</span>
				),
		},
	]

	return (
		<DataTable
			columns={columns}
			rows={entries}
			loading={isLoading}
			error={error}
			emptyMessage="No timers match these filters"
			getRowKey={(entry) => entry.id}
			rowInteraction={onSelect ? { type: 'click', onClick: onSelect } : undefined}
			variant="plain"
			className="overflow-hidden rounded-md"
		/>
	)
}
