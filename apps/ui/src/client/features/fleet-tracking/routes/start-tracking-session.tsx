import { ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { apiClient, BaseApiError } from '@/lib/api'
import { error as toastError, success as toastSuccess } from '@/lib/toast'
import { useStartTracking } from '../hooks'

import type { TrackingSession } from '../types'

interface CharacterFleetState {
	characterId: string
	characterName: string
	loading: boolean
	isFleetBoss: boolean
	fleetId?: string
	activeSession?: TrackingSession | null
	existingSession?: TrackingSession | null
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
			activeSession: data?.activeSession ?? null,
			existingSession: data?.existingSession ?? null,
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
	const [conflictingSession, setConflictingSession] = useState<TrackingSession | null>(null)

	const characters = user?.characters ?? []
	const { states, refetchAll } = useCharacterFleetStates(characters)

	const fleetBossStates = states.filter((s) => s.isFleetBoss)
	const anyLoading = states.some((s) => s.loading)

	const eligible = fleetBossStates.find((s) => s.characterId === selectedCharacterId)
	const selectedTrackedSession = eligible?.activeSession ?? eligible?.existingSession ?? null
	const selectedTrackedSessionBossId =
		selectedTrackedSession?.currentFleetBossCharacterId ??
		selectedTrackedSession?.currentCommanderCharacterId ??
		selectedTrackedSession?.characterId ??
		null
	const selectedPrimaryActionLabel = selectedTrackedSession
		? selectedTrackedSessionBossId && selectedTrackedSessionBossId !== selectedCharacterId
			? 'Take over'
			: 'Resume'
		: 'Start Tracking'
	const canShowNewAction = selectedTrackedSession?.status === 'ended'
	const resolvedSessionName = name.trim()
	const canSubmit =
		!!eligible && !!resolvedSessionName && !startTracking.isPending

	useEffect(() => {
		setConflictingSession(null)
	}, [selectedCharacterId])

	const selectCharacter = (characterId: string, sessionName?: string) => {
		setSelectedCharacterId(characterId)
		setConflictingSession(null)
		setName(sessionName ?? '')
	}

	const startOrTakeOverTracking = async (characterId: string, action: 'new' | 'take_over') => {
		const resolvedName = name.trim()
		if (!resolvedName) {
			toastError('Name is required')
			return
		}
		try {
			const result = await startTracking.mutateAsync({
				characterId,
				name: resolvedName,
				action,
			})
			toastSuccess('Tracking started')
			navigate(`/fleet-tracking/${result.sessionId}`)
		} catch (err) {
			if (err instanceof BaseApiError && err.status === 409) {
				const responseBody = err.requestInfo?.responseBody as
					| { session?: TrackingSession | null }
					| undefined
				if (responseBody?.session) {
					setConflictingSession(responseBody.session)
					toastError('This fleet is already being tracked.')
					return
				}
			}
			toastError(err instanceof Error ? err.message : 'Failed to start tracking')
		}
	}

	const handleSubmit = async () => {
		if (!eligible) return
		await startOrTakeOverTracking(
			eligible.characterId,
			selectedTrackedSession ? 'take_over' : 'new'
		)
	}

	return (
		<Container>
			<PageHeader
				title="Start Tracking"
				description="Start tracking a fleet you are currently in as the fleet boss."
				action={
					<Button asChild variant="ghost" size="sm">
						<Link to="/fleet-tracking">
							<ArrowLeft className="h-4 w-4" />
							Back to Fleet Tracking
						</Link>
					</Button>
				}
			/>

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
								const existingSession = s.activeSession ?? s.existingSession ?? null
								const existingSessionActionLabel =
									existingSession?.currentFleetBossCharacterId &&
									existingSession.currentFleetBossCharacterId !== s.characterId
										? 'Can take over'
										: 'Can resume'
								return (
									<div
										key={s.characterId}
										className={`rounded-md border p-3 transition-colors ${
											selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent'
										}`}
									>
										<div className="flex flex-wrap items-start justify-between gap-3">
											<button
												type="button"
												onClick={() => selectCharacter(s.characterId, existingSession?.name ?? '')}
												className="min-w-0 flex-1 text-left"
											>
												<div className="font-medium">{s.characterName}</div>
												<div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
													<span className="flex items-center gap-1 text-success">
														<CheckCircle2 className="h-4 w-4" />
														Fleet boss of fleet {s.fleetId}
													</span>
												</div>
												{existingSession ? (
													<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
														<span>
															{existingSession.status === 'active' ? 'Active session:' : 'Existing session:'}{' '}
															<span className="text-foreground">{existingSession.name}</span>
														</span>
														<span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
															{existingSessionActionLabel}
														</span>
													</div>
												) : null}
											</button>
										</div>
									</div>
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
							<Label htmlFor="session-name">Name</Label>
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

				{conflictingSession && (
					<Card className="mt-4 border-amber-500/40 bg-amber-500/5">
						<CardHeader>
							<CardTitle className="text-base">Fleet already tracked</CardTitle>
						</CardHeader>
						<CardContent className="space-y-3 text-sm">
							<div className="text-muted-foreground">
								This fleet already has an active tracking session. Select a different fleet boss
								to start a new track, or take over this one from the action buttons below.
							</div>
							<div className="flex flex-wrap items-center gap-3">
								<div className="font-medium text-foreground">
									{conflictingSession.name}
								</div>
								<div className="text-muted-foreground">
									Tracked FC:{' '}
									<span className="text-foreground">
										{conflictingSession.characterName ?? conflictingSession.characterId}
									</span>
								</div>
								{conflictingSession.currentCommanderCharacterId &&
								conflictingSession.currentCommanderCharacterId !== conflictingSession.characterId ? (
									<div className="text-muted-foreground">
										Current FC:{' '}
										<span className="text-foreground">
											{conflictingSession.currentCommanderCharacterName ??
												conflictingSession.currentCommanderCharacterId}
										</span>
									</div>
								) : null}
							</div>
						</CardContent>
					</Card>
				)}

				<div className="mt-4 flex justify-end gap-2">
					<Button variant="ghost" asChild>
						<Link to="/fleet-tracking">Cancel</Link>
					</Button>
					{canShowNewAction ? (
						<Button variant="secondary" onClick={() => selectedCharacterId && void startOrTakeOverTracking(selectedCharacterId, 'new')} disabled={!eligible || !resolvedSessionName || startTracking.isPending}>
							New
						</Button>
					) : null}
					<Button onClick={handleSubmit} disabled={!canSubmit}>
						{selectedPrimaryActionLabel}
					</Button>
				</div>
			</Section>
		</Container>
	)
}
