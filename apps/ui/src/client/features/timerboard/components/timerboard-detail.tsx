import {
	Building2,
	ChevronDown,
	ChevronUp,
	Clock3,
	Globe2,
	MapPin,
	Moon,
	Stars,
	UserRound,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { OrganizationLogo } from '@/components/corporation-logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { useAuth } from '@/hooks/useAuth'
import { characterPortraitUrl } from '@/lib/eve-images'

import {
	useAssignTimerboardEntry,
	useSetTimerboardState,
	useTimerboardActivity,
	useTimerboardEntry,
	useTimerboardStructureDetail,
} from '../hooks'
import {
	timerboardHostilityVariants,
	timerboardPriorityStyles,
	timerboardStateVariants,
	TimerboardStructure,
	timerboardStructureOptions,
	TimerboardTimerType,
} from '../timerboard-visuals'
import { TimerboardAssignmentSelect } from './timerboard-assignment-select'

import type { FormEvent } from 'react'
import type {
	TimerboardActivity,
	TimerboardAssignmentCandidate,
	TimerboardEntry,
	TimerState,
} from '../types'

const fieldLabels: Record<string, string> = {
	assignedCharacterId: 'Character ID',
	assignedCharacterName: 'Character name',
	assignedUserId: 'User',
	subjectId: 'Subject ID',
	subjectName: 'Subject name',
	subjectType: 'Subject type',
	category: 'Category',
	notes: 'Notes',
	priority: 'Priority',
	hostility: 'Hostility',
	startsAt: 'Start time',
	systemId: 'System ID',
	systemName: 'System name',
	title: 'Title',
}

function activityValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return 'None'
	if (typeof value === 'object') {
		const assignment = value as Record<string, unknown>
		return (
			[assignment.characterName, assignment.characterId, assignment.userId]
				.filter((part): part is string => typeof part === 'string' && part.length > 0)
				.join(' · ') || 'Unassigned'
		)
	}
	return String(value)
}

function activityDetails(activity: TimerboardActivity): string[] {
	if (activity.action === 'created') return ['Timer created']

	if (activity.action === 'updated') {
		const changes = activity.payload.changes
		if (!changes || typeof changes !== 'object') return []
		return Object.entries(changes).flatMap(([field, value]) => {
			if (!value || typeof value !== 'object') return []
			const change = value as Record<string, unknown>
			return [
				`${fieldLabels[field] ?? field}: ${activityValue(change.previous)} → ${activityValue(change.next)}`,
			]
		})
	}

	if (activity.action === 'assigned') {
		return [
			`Assignment: ${activityValue(activity.payload.previous)} → ${activityValue(activity.payload.next)}`,
		]
	}

	if (activity.action === 'state_changed' || activity.action === 'cancelled') {
		return [
			`State: ${activityValue(activity.payload.previous)} → ${activityValue(activity.payload.next)}`,
		]
	}

	return []
}

export function TimerboardDetail({
	entryId,
	onEdit,
}: {
	entryId: string
	onEdit: (entry: TimerboardEntry) => void
}) {
	const entryQuery = useTimerboardEntry(entryId)
	const activityQuery = useTimerboardActivity(entryId)
	const structureLookupId =
		entryQuery.data?.subjectId &&
		timerboardStructureOptions.some(({ value }) => value === entryQuery.data?.subjectType)
			? entryQuery.data.subjectId
			: null
	const structureQuery = useTimerboardStructureDetail(structureLookupId)
	const setState = useSetTimerboardState()
	const assign = useAssignTimerboardEntry()
	const { user } = useAuth()
	const [assignmentCandidate, setAssignmentCandidate] =
		useState<TimerboardAssignmentCandidate | null>(null)
	const [activityExpanded, setActivityExpanded] = useState(false)

	useEffect(() => {
		setAssignmentCandidate(null)
		setActivityExpanded(false)
	}, [entryId])

	if (entryQuery.isLoading) return <p role="status">Loading timer…</p>
	if (entryQuery.error)
		return (
			<p role="alert" className="text-destructive">
				{entryQuery.error.message}
			</p>
		)
	const entry = entryQuery.data
	if (!entry) return <p role="alert">Timer not found.</p>

	const transition = (state: TimerState) =>
		setState.mutate({ entryId, state, expectedVersion: entry.version })

	const submitAssignment = (event: FormEvent) => {
		event.preventDefault()
		if (!assignmentCandidate) return
		assign.mutate({
			entryId,
			input: {
				userId: assignmentCandidate.userId,
				characterId: assignmentCandidate.characterId,
				characterName: assignmentCandidate.characterName,
				expectedVersion: entry.version,
			},
		})
	}
	const assignToMe = () => {
		if (!user) return
		const character = user.characters.find(
			({ characterId }) => characterId === user.mainCharacterId
		)
		if (!character) return
		assign.mutate({
			entryId,
			input: {
				userId: user.id,
				characterId: character.characterId,
				characterName: character.characterName,
				expectedVersion: entry.version,
			},
		})
	}

	return (
		<div className="space-y-4">
			<section className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={timerboardHostilityVariants[entry.hostility]} className="capitalize">
						{entry.hostility}
					</Badge>
					<span className="flex items-center gap-1.5 text-sm text-muted-foreground">
						<span
							className={`h-2.5 w-2.5 rounded-full ${timerboardPriorityStyles[entry.priority]}`}
							aria-label={`${entry.priority} priority`}
						/>
						<span className="capitalize">{entry.priority} priority</span>
					</span>
					<Badge variant={timerboardStateVariants[entry.state]} className="capitalize">
						{entry.state}
					</Badge>
					<span className="text-xs uppercase tracking-wide text-muted-foreground">
						{entry.category}
					</span>
				</div>
				<div>
					<h2 className="text-2xl font-semibold">{entry.title}</h2>
					<div className="mt-1 text-sm text-muted-foreground">
						<TimerboardTimerType type={entry.timerType} />
					</div>
				</div>
				<div className="grid gap-2 sm:grid-cols-2">
					<div className="rounded-md border border-border/60 bg-background/40 p-2.5">
						<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
							<Clock3 className="h-3.5 w-3.5" /> When
						</div>
						<div className="mt-1 font-medium">
							<EveTimeDisplay dateStr={entry.startsAt} format="compact" />
						</div>
					</div>
					<div className="rounded-md border border-border/60 bg-background/40 p-2.5">
						<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
							<Building2 className="h-3.5 w-3.5" /> Structure
						</div>
						<div className="mt-1 text-sm">
							<TimerboardStructure
								type={entry.subjectType}
								name={structureQuery.data?.name ?? entry.subjectName}
							/>
							{structureQuery.data?.typeName ? (
								<div className="mt-1 text-xs text-muted-foreground">
									{structureQuery.data.typeName}
								</div>
							) : null}
						</div>
					</div>
					<div className="rounded-md border border-border/60 bg-background/40 p-2.5">
						<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
							<MapPin className="h-3.5 w-3.5" /> Location
						</div>
						<div className="mt-1 font-medium">
							<div className="flex items-center gap-1.5">
								<Stars className="h-4 w-4 shrink-0 text-purple-300" />
								<span>{entry.systemName || 'Unknown system'}</span>
								{entry.moonName || entry.planetName ? (
									<>
										<span> - </span>
										{entry.moonName ? (
											<Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
										) : (
											<Globe2 className="h-4 w-4 shrink-0 text-sky-300" />
										)}
										<span>{entry.moonName ? `Moon ${entry.moonName}` : entry.planetName}</span>
									</>
								) : null}
							</div>
						</div>
						<div className="text-xs text-muted-foreground">
							{entry.regionName ? (
								<span className="flex items-center gap-1.5">{entry.regionName}</span>
							) : null}
						</div>
					</div>
					<div className="rounded-md border border-border/60 bg-background/40 p-2.5">
						<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
							<UserRound className="h-3.5 w-3.5" /> Response owner
						</div>
						{entry.assignedCharacterId && entry.assignedCharacterName ? (
							<div className="mt-1 flex items-center gap-2">
								<img
									src={characterPortraitUrl(entry.assignedCharacterId, 32)}
									alt=""
									className="h-7 w-7 rounded-full"
									loading="lazy"
								/>
								<span className="font-medium">{entry.assignedCharacterName}</span>
							</div>
						) : (
							<div className="mt-1 font-medium">Unassigned</div>
						)}
					</div>
					<div className="rounded-md border border-border/60 bg-background/40 p-2.5 sm:col-span-2">
						<div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
							<Building2 className="h-3.5 w-3.5" /> Organization
						</div>
						{entry.corporationId || entry.corporationName ? (
							<div className="mt-1 flex min-w-0 items-center gap-2">
								<OrganizationLogo
									corporationId={entry.corporationId ?? '0'}
									corporationName={entry.corporationName}
									allianceId={entry.allianceId}
									allianceName={entry.allianceName}
									size="md"
								/>
								<div className="min-w-0">
									<div className="truncate font-medium">
										{entry.corporationName || 'Unknown corporation'}
										{entry.corporationTicker ? (
											<span className="font-normal text-muted-foreground">
												{' '}
												[{entry.corporationTicker}]
											</span>
										) : null}
									</div>
									{entry.allianceName ? (
										<div className="truncate text-xs text-muted-foreground">
											{entry.allianceName}
											{entry.allianceTicker ? ` [${entry.allianceTicker}]` : ''}
										</div>
									) : null}
								</div>
							</div>
						) : (
							<div className="mt-1 text-sm text-muted-foreground">Unassigned</div>
						)}
					</div>
				</div>
				{entry.notes ? (
					<div className="whitespace-pre-wrap rounded-md border border-border/60 bg-background/40 p-2.5 text-sm">
						{entry.notes}
					</div>
				) : null}
			</section>

			{setState.error ? (
				<p className="text-sm text-destructive" role="alert">
					{setState.error.message}
				</p>
			) : null}

			{entry.actions.canAssign ? (
				<form
					className="w-full space-y-2 rounded-md border border-border p-3"
					onSubmit={submitAssignment}
				>
					<h3 className="font-medium">Assign response owner</h3>
					<div className="space-y-1">
						<label htmlFor="timerboard-assignment" className="sr-only">
							Response owner
						</label>
						<TimerboardAssignmentSelect
							inputId="timerboard-assignment"
							value={assignmentCandidate}
							disabled={assign.isPending}
							onChange={setAssignmentCandidate}
						/>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={
								assign.isPending ||
								!user ||
								!user.characters.some(({ characterId }) => characterId === user.mainCharacterId)
							}
							onClick={assignToMe}
						>
							<UserRound /> Assign to me
						</Button>
						<Button type="submit" size="sm" disabled={assign.isPending || !assignmentCandidate}>
							Assign
						</Button>
						{entry.assignedUserId ? (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() =>
									assign.mutate({
										entryId,
										input: {
											userId: null,
											characterId: null,
											characterName: null,
											expectedVersion: entry.version,
										},
									})
								}
							>
								Unassign
							</Button>
						) : null}
					</div>
					{assign.error ? (
						<p className="text-sm text-destructive" role="alert">
							{assign.error.message}
						</p>
					) : null}
				</form>
			) : null}

			<div className="flex flex-wrap justify-end gap-2" aria-label="Timer actions">
				{entry.actions.canEdit ? (
					<Button size="sm" variant="secondary" onClick={() => onEdit(entry)}>
						Edit
					</Button>
				) : null}
				{entry.actions.canSetCovered ? (
					<Button size="sm" variant="primary" onClick={() => transition('covered')}>
						Mark covered
					</Button>
				) : null}
				{entry.actions.canComplete ? (
					<Button size="sm" variant="success" onClick={() => transition('completed')}>
						Complete
					</Button>
				) : null}
				{entry.actions.canCancel ? (
					<Button size="sm" variant="danger" onClick={() => transition('cancelled')}>
						Cancel timer
					</Button>
				) : null}
			</div>

			<section
				className="rounded-md border border-border/60"
				aria-labelledby="timer-activity-heading"
			>
				<button
					type="button"
					className="flex w-full cursor-pointer items-center justify-between gap-2 p-3 text-left"
					aria-expanded={activityExpanded}
					aria-controls="timer-activity-log"
					onClick={() => setActivityExpanded((expanded) => !expanded)}
				>
					<span className="flex items-center gap-2">
						<h3 id="timer-activity-heading" className="text-base font-semibold">
							Activity
						</h3>
						<Badge variant="ghost">{activityQuery.data?.length ?? 0}</Badge>
					</span>
					{activityExpanded ? <ChevronUp /> : <ChevronDown />}
				</button>
				{activityExpanded ? (
					<div id="timer-activity-log" className="space-y-2 border-t border-border/60 p-3">
						{activityQuery.isLoading ? <p role="status">Loading activity…</p> : null}
						{activityQuery.error ? (
							<p role="alert" className="text-destructive">
								{activityQuery.error.message}
							</p>
						) : null}
						<ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
							{activityQuery.data?.map((activity) => {
								const details = activityDetails(activity)
								return (
									<li
										key={activity.id}
										className="rounded-md border border-border/70 bg-muted/10 p-2.5 text-sm"
									>
										<p className="font-medium">{activity.action.replaceAll('_', ' ')}</p>
										{details.map((detail) => (
											<p key={detail} className="mt-1 break-words">
												{detail}
											</p>
										))}
										<p className="mt-1 text-xs text-muted-foreground">
											By {activity.actorCharacterName ?? 'Unknown user'} ·{' '}
											<EveTimeDisplay dateStr={activity.createdAt} format="compact" />
										</p>
									</li>
								)
							})}
						</ul>
					</div>
				) : null}
			</section>
		</div>
	)
}
