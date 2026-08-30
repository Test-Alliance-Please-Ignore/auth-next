import { useCallback } from 'react'

import { Select } from '@/components/ui/select'
import { api } from '@/lib/api'
import { characterPortraitUrl } from '@/lib/eve-images'

import type { SelectOption } from '@/components/ui/select'
import type { TimerboardAssignmentCandidate } from '../types'

type AssignmentOption = SelectOption & TimerboardAssignmentCandidate

function mapCandidate(candidate: TimerboardAssignmentCandidate): AssignmentOption {
	return {
		...candidate,
		value: candidate.characterId,
		label: candidate.characterName,
		description: candidate.isPrimary ? 'Main character' : 'Alternate character',
	}
}

export function TimerboardAssignmentSelect({
	value,
	disabled = false,
	inputId,
	onChange,
}: {
	value: TimerboardAssignmentCandidate | null
	disabled?: boolean
	inputId?: string
	onChange: (candidate: TimerboardAssignmentCandidate | null) => void
}) {
	const searchDelegate = useCallback(async (query: string): Promise<AssignmentOption[]> => {
		const candidates = await api.searchTimerboardAssignmentCandidates(query)
		return candidates.map(mapCandidate)
	}, [])

	return (
		<Select<AssignmentOption>
			inputId={inputId}
			value={value?.characterId ?? ''}
			options={value ? [mapCandidate(value)] : []}
			searchable
			searchDelegate={searchDelegate}
			minQueryLength={2}
			placeholder="Search characters by name…"
			disabled={disabled}
			onValueChange={(_nextValue, option) => {
				onChange(
					option
						? {
								userId: option.userId,
								characterId: option.characterId,
								characterName: option.characterName,
								isPrimary: option.isPrimary,
							}
						: null
				)
			}}
			loadingText="Searching characters…"
			emptyText="No matching characters"
			queryHintText="Type at least 2 characters"
			renderOption={(option) => (
				<div className="flex min-w-0 items-center gap-2">
					<img
						src={characterPortraitUrl(option.characterId, 32)}
						alt=""
						width={28}
						height={28}
						className="h-7 w-7 shrink-0 rounded-full"
					/>
					<div className="min-w-0">
						<div className="truncate font-medium" title={option.characterName}>
							{option.characterName}
						</div>
						<div className="text-xs text-muted-foreground">{option.description}</div>
					</div>
				</div>
			)}
		/>
	)
}
