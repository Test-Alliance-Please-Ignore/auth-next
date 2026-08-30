import { useState } from 'react'

import { TIMERBOARD_KINDS, TIMERBOARD_PRIORITIES, TIMERBOARD_SIDES } from '@repo/core'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { ConflictError } from '@/lib/api'

import { useCreateTimerboardEntry, useUpdateTimerboardEntry } from '../hooks'

import type { FormEvent } from 'react'
import type {
	CreateTimerboardEntryInput,
	TimerboardEntry,
	TimerKind,
	TimerPriority,
	TimerSide,
} from '../types'

function toEveInput(instant: string | null | undefined): string {
	return instant ? instant.slice(0, 16) : ''
}

function toUtcInstant(value: string): string {
	return new Date(`${value}:00.000Z`).toISOString()
}

const fieldClass =
	'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

const selectOptions = (values: readonly string[]) =>
	values.map((value) => ({
		value,
		label: `${value[0]?.toUpperCase()}${value.slice(1)}`,
	}))

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
	const [title, setTitle] = useState(entry?.title ?? '')
	const [kind, setKind] = useState<TimerKind>(entry?.kind ?? 'custom')
	const [priority, setPriority] = useState<TimerPriority>(entry?.priority ?? 'normal')
	const [side, setSide] = useState<TimerSide>(entry?.side ?? 'unknown')
	const [startsAt, setStartsAt] = useState(toEveInput(entry?.startsAt))
	const [endsAt, setEndsAt] = useState(toEveInput(entry?.endsAt))
	const [systemName, setSystemName] = useState(entry?.systemName ?? '')
	const [systemId, setSystemId] = useState(entry?.systemId ?? '')
	const [entityName, setEntityName] = useState(entry?.entityName ?? '')
	const [entityId, setEntityId] = useState(entry?.entityId ?? '')
	const [entityType, setEntityType] = useState(entry?.entityType ?? '')
	const [notes, setNotes] = useState(entry?.notes ?? '')
	const [clientError, setClientError] = useState<string | null>(null)
	const [conflict, setConflict] = useState<TimerboardEntry | null>(null)
	const [expectedVersion, setExpectedVersion] = useState(entry?.version ?? 1)
	const mutation = entry ? updateEntry : createEntry

	const loadConflict = () => {
		if (!conflict) return
		setTitle(conflict.title)
		setKind(conflict.kind)
		setPriority(conflict.priority)
		setSide(conflict.side)
		setStartsAt(toEveInput(conflict.startsAt))
		setEndsAt(toEveInput(conflict.endsAt))
		setSystemName(conflict.systemName ?? '')
		setSystemId(conflict.systemId ?? '')
		setEntityName(conflict.entityName ?? '')
		setEntityId(conflict.entityId ?? '')
		setEntityType(conflict.entityType ?? '')
		setNotes(conflict.notes ?? '')
		setExpectedVersion(conflict.version)
		setConflict(null)
	}

	const handleSubmit = async (event: FormEvent) => {
		event.preventDefault()
		setClientError(null)
		if (!startsAt) {
			setClientError('Start time is required and is interpreted as EVE time (UTC).')
			return
		}
		const normalizedStart = toUtcInstant(startsAt)
		const normalizedEnd = endsAt ? toUtcInstant(endsAt) : null
		if (normalizedEnd && normalizedEnd <= normalizedStart) {
			setClientError('End time must be later than start time.')
			return
		}

		const input: CreateTimerboardEntryInput = {
			kind,
			title: title.trim(),
			priority,
			side,
			startsAt: normalizedStart,
			endsAt: normalizedEnd,
			systemId: systemId.trim() || null,
			systemName: systemName.trim() || null,
			entityId: entityId.trim() || null,
			entityType: entityType.trim() || null,
			entityName: entityName.trim() || null,
			notes: notes.trim() || null,
		}

		try {
			const saved = entry
				? await updateEntry.mutateAsync({
						entryId: entry.id,
						input: { ...input, expectedVersion },
					})
				: await createEntry.mutateAsync(input)
			onSaved(saved)
		} catch (error) {
			if (error instanceof ConflictError && error.current) {
				setConflict(error.current as TimerboardEntry)
			}
		}
	}

	return (
		<form className="space-y-4" onSubmit={handleSubmit}>
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

			<label className="block space-y-1 text-sm font-medium">
				Title
				<input
					className={fieldClass}
					required
					maxLength={160}
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
			</label>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
				<label className="space-y-1 text-sm font-medium" htmlFor="timer-kind">
					Kind
					<Select
						inputId="timer-kind"
						options={selectOptions(TIMERBOARD_KINDS)}
						value={kind}
						onValueChange={(value) => setKind(value as TimerKind)}
					/>
				</label>
				<label className="space-y-1 text-sm font-medium" htmlFor="timer-priority">
					Priority
					<Select
						inputId="timer-priority"
						options={selectOptions(TIMERBOARD_PRIORITIES)}
						value={priority}
						onValueChange={(value) => setPriority(value as TimerPriority)}
					/>
				</label>
				<label className="space-y-1 text-sm font-medium" htmlFor="timer-side">
					Side
					<Select
						inputId="timer-side"
						options={selectOptions(TIMERBOARD_SIDES)}
						value={side}
						onValueChange={(value) => setSide(value as TimerSide)}
					/>
				</label>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<label className="space-y-1 text-sm font-medium">
					Starts at (EVE/UTC)
					<input
						className={fieldClass}
						required
						type="datetime-local"
						value={startsAt}
						onChange={(event) => setStartsAt(event.target.value)}
					/>
				</label>
				<label className="space-y-1 text-sm font-medium">
					Ends at (EVE/UTC, optional)
					<input
						className={fieldClass}
						type="datetime-local"
						value={endsAt}
						onChange={(event) => setEndsAt(event.target.value)}
					/>
				</label>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
				<label className="space-y-1 text-sm font-medium">
					System name
					<input
						className={fieldClass}
						maxLength={120}
						value={systemName}
						onChange={(event) => setSystemName(event.target.value)}
					/>
				</label>
				<label className="space-y-1 text-sm font-medium">
					System ID
					<input
						className={fieldClass}
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={32}
						value={systemId}
						onChange={(event) => setSystemId(event.target.value)}
					/>
				</label>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_10rem]">
				<label className="space-y-1 text-sm font-medium">
					Linked entity name
					<input
						className={fieldClass}
						maxLength={160}
						value={entityName}
						onChange={(event) => setEntityName(event.target.value)}
					/>
				</label>
				<label className="space-y-1 text-sm font-medium">
					Entity ID
					<input
						className={fieldClass}
						inputMode="numeric"
						pattern="[0-9]*"
						maxLength={32}
						value={entityId}
						onChange={(event) => setEntityId(event.target.value)}
					/>
				</label>
				<label className="space-y-1 text-sm font-medium">
					Entity type
					<input
						className={fieldClass}
						maxLength={80}
						value={entityType}
						onChange={(event) => setEntityType(event.target.value)}
					/>
				</label>
			</div>
			<label className="block space-y-1 text-sm font-medium">
				Notes (plaintext)
				<textarea
					className={fieldClass}
					rows={4}
					maxLength={2000}
					value={notes}
					onChange={(event) => setNotes(event.target.value)}
				/>
			</label>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={mutation.isPending}>
					{mutation.isPending ? 'Saving…' : entry ? 'Save changes' : 'Create timer'}
				</Button>
			</div>
		</form>
	)
}
