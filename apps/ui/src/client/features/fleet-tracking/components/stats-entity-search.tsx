import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Select } from '@/components/ui/select'

import { useStatsEntitySearch } from '../hooks'

/**
 * Two side-by-side search boxes on the stats overview: one for characters that
 * have appeared in any tracked fleet, one for corporations. Navigates to the
 * relevant stats page on selection.
 */
export function StatsEntitySearch() {
	const navigate = useNavigate()
	const [charQuery, setCharQuery] = useState('')
	const [corpQuery, setCorpQuery] = useState('')

	const charSearch = useStatsEntitySearch(charQuery)
	const corpSearch = useStatsEntitySearch(corpQuery)

	const characterOptions = (charSearch.data?.characters ?? []).map((c) => ({
		value: c.characterId,
		label: c.characterName,
	}))

	const corporationOptions = (corpSearch.data?.corporations ?? []).map((c) => ({
		value: c.corporationId,
		label: c.corporationName ?? c.corporationId,
	}))

	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div>
				<label htmlFor="stats-find-character" className="text-sm text-muted-foreground">
					Find character
				</label>
				<Select
					inputId="stats-find-character"
					value=""
					onValueChange={(value) => {
						if (!value) return
						setCharQuery('')
						navigate(`/fleet-tracking/stats/characters/${value}`)
					}}
					query={charQuery}
					onQueryChange={setCharQuery}
					searchable
					searchDelegate={() => characterOptions}
					options={characterOptions}
					loading={charSearch.isFetching}
					placeholder="Search character name"
					queryHintText="Type at least 2 characters"
					minQueryLength={2}
					debounceMs={0}
					emptyText="No matching pilots in tracked fleets"
				/>
			</div>
			<div>
				<label htmlFor="stats-find-corporation" className="text-sm text-muted-foreground">
					Find corporation
				</label>
				<Select
					inputId="stats-find-corporation"
					value=""
					onValueChange={(value) => {
						if (!value) return
						setCorpQuery('')
						navigate(`/fleet-tracking/stats/corporations/${value}`)
					}}
					query={corpQuery}
					onQueryChange={setCorpQuery}
					searchable
					searchDelegate={() => corporationOptions}
					options={corporationOptions}
					loading={corpSearch.isFetching}
					placeholder="Search corporation name"
					queryHintText="Type at least 2 characters"
					minQueryLength={2}
					debounceMs={0}
					emptyText="No matching corps in tracked fleets"
				/>
			</div>
		</div>
	)
}
