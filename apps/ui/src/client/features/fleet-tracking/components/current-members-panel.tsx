import { AlertTriangle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { HoverPopover } from '@/components/ui/hover-popover'
import { Input } from '@/components/ui/input'
import {
	SortableTableHead,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { useAppTranslation } from '@/i18n'

import { formatDurationBetween } from '../utils/format'

import type { SessionCurrentMember, SessionGroupCount, SessionLiveMemberLocation } from '../types'

type SortKey = 'characterName' | 'shipTypeName' | 'groupName' | 'systemName' | 'sinceTime'

interface CurrentMembersPanelProps {
	sessionId: string
	members: SessionCurrentMember[]
	groupCounts: SessionGroupCount[]
	liveLocations?: SessionLiveMemberLocation[]
	doctrineShipTypeIds?: Set<string>
	canKickMembers?: boolean
	onKickMembers?: (memberCharacterIds: string[]) => Promise<void>
	isKickingMembers?: boolean
}

export function CurrentMembersPanel({
	sessionId,
	members,
	groupCounts,
	liveLocations = [],
	doctrineShipTypeIds,
	canKickMembers = false,
	onKickMembers,
	isKickingMembers = false,
}: CurrentMembersPanelProps) {
	const { t } = useAppTranslation()

	const [query, setQuery] = useState('')
	const [sortKey, setSortKey] = useState<SortKey>('characterName')
	const [asc, setAsc] = useState(true)
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()
	const trimmed = query.trim().toLowerCase()
	const liveLocationByCharacterId = useMemo(
		() => new Map(liveLocations.map((location) => [location.characterId, location])),
		[liveLocations, t]
	)
	const mergedMembers = useMemo(() => {
		return members.map((member) => {
			const liveLocation = liveLocationByCharacterId.get(member.characterId)
			if (!liveLocation) {
				return member
			}
			return {
				...member,
				solarSystemId: liveLocation.solarSystemId,
				systemName: liveLocation.systemName ?? member.systemName,
				stationId: liveLocation.stationId,
			}
		})
	}, [liveLocationByCharacterId, members, t])

	const filteredMembers = useMemo(() => {
		if (!trimmed) return mergedMembers
		return mergedMembers.filter((m) => {
			const fields = [m.characterName, m.shipTypeName, m.groupName, m.systemName]
			return fields.some((f) => f?.toLowerCase().includes(trimmed))
		})
	}, [mergedMembers, trimmed, t])

	const sortedMembers = useMemo(() => {
		const out = [...filteredMembers]
		out.sort((a, b) => {
			let cmp = 0
			switch (sortKey) {
				case 'characterName':
					cmp = (a.characterName ?? a.characterId).localeCompare(b.characterName ?? b.characterId)
					break
				case 'shipTypeName':
					cmp = (a.shipTypeName ?? `type #${a.shipTypeId}`).localeCompare(
						b.shipTypeName ?? `type #${b.shipTypeId}`
					)
					break
				case 'groupName':
					cmp = (a.groupName ?? '').localeCompare(b.groupName ?? '')
					break
				case 'systemName':
					cmp = (a.systemName ?? '').localeCompare(b.systemName ?? '')
					break
				case 'sinceTime':
					cmp = a.sinceTime.localeCompare(b.sinceTime)
					break
			}
			return asc ? cmp : -cmp
		})
		return out
	}, [filteredMembers, sortKey, asc, t])

	const onHeaderClick = (key: SortKey) => {
		if (sortKey === key) {
			setAsc(!asc)
			return
		}
		setSortKey(key)
		setAsc(true)
	}

	const isCapsule = (member: SessionCurrentMember) => {
		const ship = member.shipTypeName?.toLowerCase() ?? ''
		const group = member.groupName?.toLowerCase() ?? ''
		return ship.includes('capsule') || group.includes('capsule')
	}
	const visiblePods = sortedMembers.filter((m) => isCapsule(m))
	const kickMembers = onKickMembers
	const normalizeShipTypeId = (value: string | number | null | undefined): string | null => {
		if (value === null || value === undefined) return null
		const raw = String(value).trim()
		if (!raw) return null
		const asNumber = Number(raw)
		return Number.isFinite(asNumber) ? String(asNumber) : raw
	}

	return (
		<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
			<div className="lg:col-span-2">
				<Card>
					<CardHeader>
						<div className="flex items-center gap-3 flex-wrap">
							<CardTitle className="text-base">
								{t('fleetTracking.currentMembers')}{' '}
								<span className="text-muted-foreground font-normal">
									{trimmed && filteredMembers.length !== members.length
										? `(${filteredMembers.length} of ${members.length})`
										: `(${members.length})`}
								</span>
							</CardTitle>
							<div className="ml-auto flex items-center gap-2">
								<Input
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder={t('fleetTracking.searchPilotShipSystem')}
									className="w-64"
								/>
								{canKickMembers && kickMembers && (
									<Button
										variant="destructive"
										size="default"
										disabled={isKickingMembers || visiblePods.length === 0}
										onClick={() =>
											requestConfirmation({
												title: t('fleetTracking.kickAllVisiblePods'),
												description: t('fleetTracking.removeVisiblePods', {
													count: visiblePods.length,
												}),
												confirmLabel: t('fleetTracking.kickPods'),
												cancelLabel: t('fleetTracking.cancel'),
												intent: 'destructive',
												onConfirm: async () => {
													await kickMembers(visiblePods.map((m) => m.characterId))
												},
											})
										}
									>
										{t('fleetTracking.kickAllPods')}
									</Button>
								)}
							</div>
						</div>
					</CardHeader>
					<CardContent className="p-0">
						{members.length === 0 ? (
							<div className="py-8 text-center text-sm text-muted-foreground">
								{t('fleetTracking.noMembersInFleetRightNow')}
							</div>
						) : filteredMembers.length === 0 ? (
							<div className="py-8 text-center text-sm text-muted-foreground">
								{t('fleetTracking.noMembersMatch')}
								{query}".
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<SortableHead
											label={t('fleetTracking.pilot')}
											k="characterName"
											sortKey={sortKey}
											asc={asc}
											onClick={onHeaderClick}
										/>
										<SortableHead
											label={t('fleetTracking.ship')}
											k="shipTypeName"
											sortKey={sortKey}
											asc={asc}
											onClick={onHeaderClick}
										/>
										<SortableHead
											label={t('fleetTracking.group')}
											k="groupName"
											sortKey={sortKey}
											asc={asc}
											onClick={onHeaderClick}
										/>
										<SortableHead
											label={t('fleetTracking.system')}
											k="systemName"
											sortKey={sortKey}
											asc={asc}
											onClick={onHeaderClick}
										/>
										<SortableHead
											label={t('fleetTracking.inShip')}
											k="sinceTime"
											sortKey={sortKey}
											asc={asc}
											onClick={onHeaderClick}
										/>
										{canKickMembers && (
											<TableHead className="w-20 text-right">
												{t('fleetTracking.actions')}
											</TableHead>
										)}
									</TableRow>
								</TableHeader>
								<TableBody>
									{sortedMembers.map((m) => {
										const memberShipTypeId = normalizeShipTypeId(m.shipTypeId)
										const doctrineMismatch =
											doctrineShipTypeIds != null &&
											doctrineShipTypeIds.size > 0 &&
											(!memberShipTypeId || !doctrineShipTypeIds.has(memberShipTypeId))
										return (
											<TableRow
												key={m.characterId}
												className={
													doctrineMismatch
														? 'odd:!bg-yellow-500/15 even:!bg-yellow-500/15 hover:!bg-yellow-500/20 border-l-2 border-l-yellow-400'
														: undefined
												}
											>
												<TableCell>
													<Link
														to={`/fleet-tracking/${sessionId}/members/${m.characterId}`}
														className="hover:underline"
													>
														{m.characterName ?? m.characterId}
													</Link>
												</TableCell>
												<TableCell>
													<span className="inline-flex items-center gap-1.5">
														{doctrineMismatch && (
															<HoverPopover
																trigger={
																	<AlertTriangle className="h-4 w-4 cursor-help text-yellow-400" />
																}
																align="start"
																side="top"
																className="w-56 p-3"
															>
																<div className="space-y-1">
																	<p className="text-xs font-semibold text-yellow-300">
																		{t('fleetTracking.notInSelectedDoctrine')}
																	</p>
																	<p className="text-xs text-muted-foreground">
																		{t(
																			'fleetTracking.thisShipTypeIsNotIncludedInTheCurrentlySelected'
																		)}
																	</p>
																</div>
															</HoverPopover>
														)}
														<span>{m.shipTypeName ?? `type #${m.shipTypeId}`}</span>
													</span>
												</TableCell>
												<TableCell className="text-muted-foreground">
													{m.groupName ?? '—'}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{m.systemName ?? `system #${m.solarSystemId}`}
												</TableCell>
												<TableCell className="text-muted-foreground">
													{formatDurationBetween(m.sinceTime, null)}
												</TableCell>
												{canKickMembers && kickMembers && (
													<TableCell className="text-right">
														<Button
															variant="destructive"
															size="sm"
															disabled={isKickingMembers}
															onClick={() =>
																requestConfirmation({
																	title: t('fleetTracking.kickThisMemberFromFleet'),
																	description: t('fleetTracking.thisWillRemoveFromTheFleet', {
																		value1: m.characterName ?? m.characterId,
																	}),
																	confirmLabel: t('fleetTracking.kickMember'),
																	cancelLabel: t('fleetTracking.cancel'),
																	intent: 'destructive',
																	onConfirm: async () => {
																		await kickMembers([m.characterId])
																	},
																})
															}
														>
															{t('fleetTracking.kick')}
														</Button>
													</TableCell>
												)}
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
				{confirmationDialog}
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">{t('fleetTracking.byShipClass')}</CardTitle>
					</CardHeader>
					<CardContent>
						{groupCounts.length === 0 ? (
							<div className="text-sm text-muted-foreground py-4">
								{t('fleetTracking.noShipsInFleetRightNow')}
							</div>
						) : (
							<ul className="space-y-1.5">
								{groupCounts.map((g) => {
									const max = Math.max(...groupCounts.map((x) => x.count), 1)
									const pct = (g.count / max) * 100
									return (
										<li key={g.groupId} className="text-sm">
											<div className="flex items-baseline justify-between gap-2">
												<span>{g.groupName ?? t('fleetTracking.unknown')}</span>
												<span className="text-muted-foreground font-mono text-xs">{g.count}</span>
											</div>
											<div className="h-1.5 mt-1 bg-muted rounded">
												<div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
											</div>
										</li>
									)
								})}
							</ul>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	)
}

function SortableHead({
	label,
	k,
	sortKey,
	asc,
	onClick,
}: {
	label: string
	k: SortKey
	sortKey: SortKey
	asc: boolean
	onClick: (k: SortKey) => void
}) {
	const active = sortKey === k
	return (
		<SortableTableHead
			onSort={() => onClick(k)}
			direction={active ? (asc ? 'asc' : 'desc') : undefined}
		>
			{label}
		</SortableTableHead>
	)
}
