import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'

import {
	useAssignTimerboardEntry,
	useSetTimerboardState,
	useTimerboardActivity,
	useTimerboardEntry,
} from '../hooks'
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
	endsAt: 'End time',
	entityId: 'Entity ID',
	entityName: 'Entity name',
	entityType: 'Entity type',
	kind: 'Kind',
	notes: 'Notes',
	priority: 'Priority',
	side: 'Side',
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
	const setState = useSetTimerboardState()
	const assign = useAssignTimerboardEntry()
	const [assignmentCandidate, setAssignmentCandidate] =
		useState<TimerboardAssignmentCandidate | null>(null)

	useEffect(() => {
		setAssignmentCandidate(null)
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

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<div className="flex flex-wrap gap-2 text-xs uppercase tracking-wide text-muted-foreground">
					<span>{entry.kind}</span>
					<span>·</span>
					<span>{entry.priority}</span>
					<span>·</span>
					<span>{entry.state}</span>
				</div>
				<h2 className="text-2xl font-semibold">{entry.title}</h2>
				<p className="text-sm text-muted-foreground">
					{entry.systemName ?? 'Unknown system'}
					{entry.entityName ? ` · ${entry.entityName}` : ''}
				</p>
				<p className="text-sm">
					Starts <EveTimeDisplay dateStr={entry.startsAt} format="compact" />
					{entry.endsAt ? (
						<>
							{' '}
							through <EveTimeDisplay dateStr={entry.endsAt} format="compact" />
						</>
					) : null}
				</p>
				<p className="text-sm">Response owner: {entry.assignedCharacterName ?? 'Unassigned'}</p>
				{entry.notes ? (
					<p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{entry.notes}</p>
				) : null}
			</div>

			<div className="flex flex-wrap gap-2" aria-label="Timer actions">
				{entry.actions.canEdit ? (
					<Button size="sm" variant="secondary" onClick={() => onEdit(entry)}>
						Edit
					</Button>
				) : null}
				{entry.actions.canSetCovered ? (
					<Button size="sm" variant="secondary" onClick={() => transition('covered')}>
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
			{setState.error ? (
				<p className="text-sm text-destructive" role="alert">
					{setState.error.message}
				</p>
			) : null}

			{entry.actions.canAssign ? (
				<form className="space-y-3 rounded-md border border-border p-3" onSubmit={submitAssignment}>
					<h3 className="font-medium">Assign response owner</h3>
					<div className="space-y-1">
						<label htmlFor="timerboard-assignment" className="block text-sm">
							Response owner
						</label>
						<TimerboardAssignmentSelect
							inputId="timerboard-assignment"
							value={assignmentCandidate}
							disabled={assign.isPending}
							onChange={setAssignmentCandidate}
						/>
					</div>
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
					{assign.error ? (
						<p className="text-sm text-destructive" role="alert">
							{assign.error.message}
						</p>
					) : null}
				</form>
			) : null}

			<section className="space-y-3" aria-labelledby="timer-activity-heading">
				<h3 id="timer-activity-heading" className="text-lg font-semibold">
					Activity
				</h3>
				{activityQuery.isLoading ? <p role="status">Loading activity…</p> : null}
				{activityQuery.error ? (
					<p role="alert" className="text-destructive">
						{activityQuery.error.message}
					</p>
				) : null}
				<ul className="space-y-2">
					{activityQuery.data?.map((activity) => {
						const details = activityDetails(activity)
						return (
							<li key={activity.id} className="rounded-md border border-border p-3 text-sm">
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
			</section>
		</div>
	)
}
