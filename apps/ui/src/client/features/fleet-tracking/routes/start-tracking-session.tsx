import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { apiClient } from '@/lib/api'
import { error as toastError, success as toastSuccess } from '@/lib/toast'
import { useStartTracking } from '../hooks'

interface CharacterFleetState {
	characterId: string
	characterName: string
	loading: boolean
	isFleetBoss: boolean
	fleetId?: string
}

function useCharacterFleetStates(
	characters: Array<{ characterId: string; characterName: string; hasValidToken: boolean }>
): {
	states: CharacterFleetState[]
	refetchAll: () => void
} {
	const queries = useQueries({
		queries: characters.map((c) => ({
			queryKey: ['fleet-tracking', 'character-fleet-info', c.characterId],
			queryFn: () => apiClient.getCharacterFleetInfo(c.characterId),
			enabled: c.hasValidToken,
			staleTime: 10_000,
			retry: false,
		})),
	})

	const states: CharacterFleetState[] = characters.map((c, idx) => {
		const q = queries[idx]
		if (!c.hasValidToken || q.isError) {
			return {
				characterId: c.characterId,
				characterName: c.characterName,
				loading: false,
				isFleetBoss: false,
			}
		}
		if (q.isLoading) {
			return {
				characterId: c.characterId,
				characterName: c.characterName,
				loading: true,
				isFleetBoss: false,
			}
		}
		const data = q.data
		return {
			characterId: c.characterId,
			characterName: c.characterName,
			loading: false,
			isFleetBoss: data ? data.fleet_boss_id === c.characterId : false,
			fleetId: data?.fleet_id,
		}
	})

	return {
		states,
		refetchAll: () => queries.forEach((q) => q.refetch()),
	}
}

export default function StartTrackingSession() {
	usePageTitle('Start Fleet Tracking')
	const { user } = useAuth()
	const navigate = useNavigate()
	const startTracking = useStartTracking()

	const [selectedCharacterId, setSelectedCharacterId] = useState<string>('')
	const [name, setName] = useState('')

	const characters = user?.characters ?? []
	const { states, refetchAll } = useCharacterFleetStates(characters)

	const fleetBossStates = states.filter((s) => s.isFleetBoss)
	const anyLoading = states.some((s) => s.loading)

	const eligible = fleetBossStates.find((s) => s.characterId === selectedCharacterId)
	const canSubmit = !!eligible && !!name.trim() && !startTracking.isPending

	const handleSubmit = async () => {
		if (!eligible) return
		try {
			const result = await startTracking.mutateAsync({
				characterId: eligible.characterId,
				name: name.trim(),
			})
			toastSuccess('Tracking started')
			navigate(`/fleet-tracking/${result.sessionId}`)
		} catch (err) {
			toastError(err instanceof Error ? err.message : 'Failed to start tracking')
		}
	}

	return (
		<Container>
			<div className="mb-4">
				<Button asChild variant="ghost" size="sm">
					<Link to="/fleet-tracking">
						<ArrowLeft className="h-4 w-4" />
						Back to Fleet Tracking
					</Link>
				</Button>
			</div>

			<PageHeader title="Start Tracking" description="Start tracking a fleet you are currently in as the fleet boss." />

			<Section>
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle>1. Select character</CardTitle>
							<Button variant="ghost" size="sm" onClick={refetchAll}>
								<RefreshCw className="h-4 w-4" />
								Refresh
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-2">
						{fleetBossStates.length === 0 ? (
							<div className="text-sm text-muted-foreground">
								{anyLoading
									? 'Checking characters…'
									: 'No characters are currently fleet boss. Form a fleet in-game and click Refresh.'}
							</div>
						) : (
							fleetBossStates.map((s) => {
								const selected = selectedCharacterId === s.characterId
								return (
									<button
										key={s.characterId}
										type="button"
										onClick={() => setSelectedCharacterId(s.characterId)}
										className={`flex items-center justify-between w-full text-left rounded-md border p-3 transition-colors cursor-pointer ${
											selected
												? 'border-primary bg-primary/5'
												: 'border-border hover:bg-accent'
										}`}
									>
										<div className="font-medium">{s.characterName}</div>
										<span className="flex items-center gap-1 text-success text-sm">
											<CheckCircle2 className="h-4 w-4" />
											Fleet boss of fleet {s.fleetId}
										</span>
									</button>
								)
							})
						)}
					</CardContent>
				</Card>

				<Card className="mt-4">
					<CardHeader>
						<CardTitle>2. Fleet name</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="space-y-1.5">
							<Label htmlFor="session-name">Name (required)</Label>
							<Input
								id="session-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="Friday CTA — DOR roam"
								maxLength={120}
							/>
						</div>
					</CardContent>
				</Card>

				<div className="mt-4 flex justify-end gap-2">
					<Button variant="ghost" asChild>
						<Link to="/fleet-tracking">Cancel</Link>
					</Button>
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						Start Tracking
					</Button>
				</div>
			</Section>
		</Container>
	)
}
