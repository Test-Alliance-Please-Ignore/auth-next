import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatDuration } from '../utils/format'

import type { SessionRosterRow } from '../types'

type SortKey = 'totalSeconds' | 'firstSeenAt' | 'shipsFlown' | 'characterName'

interface SessionRosterPanelProps {
	sessionId: string
	roster: SessionRosterRow[]
}

export function SessionRosterPanel({ sessionId, roster }: SessionRosterPanelProps) {
	const [sortKey, setSortKey] = useState<SortKey>('totalSeconds')
	const [asc, setAsc] = useState(false)

	const sorted = useMemo(() => {
		const out = [...roster]
		out.sort((a, b) => {
			let cmp = 0
			switch (sortKey) {
				case 'totalSeconds':
					cmp = a.totalSeconds - b.totalSeconds
					break
				case 'firstSeenAt':
					cmp = a.firstSeenAt.localeCompare(b.firstSeenAt)
					break
				case 'shipsFlown':
					cmp = a.shipsFlown - b.shipsFlown
					break
				case 'characterName':
					cmp = (a.characterName ?? a.characterId).localeCompare(
						b.characterName ?? b.characterId
					)
					break
			}
			return asc ? cmp : -cmp
		})
		return out
	}, [roster, sortKey, asc])

	const onHeaderClick = (key: SortKey) => {
		if (sortKey === key) setAsc(!asc)
		else {
			setSortKey(key)
			setAsc(key === 'characterName' || key === 'firstSeenAt')
		}
	}

	const stayedCount = roster.filter((r) => r.stayedToEnd).length
	const leftCount = roster.length - stayedCount

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between flex-wrap gap-2">
					<CardTitle className="text-base">
						Roster{' '}
						<span className="text-muted-foreground font-normal">({roster.length})</span>
					</CardTitle>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>{stayedCount} stayed to the end</span>
						{leftCount > 0 && (
							<>
								<span>·</span>
								<span>{leftCount} left early</span>
							</>
						)}
					</div>
				</div>
			</CardHeader>
			<CardContent className="p-0">
				{roster.length === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">
						No members recorded for this session.
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<SortableHead label="Pilot" k="characterName" sortKey={sortKey} asc={asc} onClick={onHeaderClick} />
								<SortableHead label="Time in fleet" k="totalSeconds" sortKey={sortKey} asc={asc} onClick={onHeaderClick} />
								<SortableHead label="Ships" k="shipsFlown" sortKey={sortKey} asc={asc} onClick={onHeaderClick} />
								<TableHead>Last ship</TableHead>
								<SortableHead label="Joined" k="firstSeenAt" sortKey={sortKey} asc={asc} onClick={onHeaderClick} />
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{sorted.map((row) => (
								<TableRow key={row.characterId}>
									<TableCell>
										<Link
											to={`/fleet-tracking/${sessionId}/members/${row.characterId}`}
											className="hover:underline"
										>
											{row.characterName ?? row.characterId}
										</Link>
									</TableCell>
									<TableCell>{formatDuration(row.totalSeconds * 1000)}</TableCell>
									<TableCell>{row.shipsFlown}</TableCell>
									<TableCell className="text-muted-foreground">
										{row.lastShipTypeName ?? `type #${row.lastShipTypeId}`}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{new Date(row.firstSeenAt).toLocaleTimeString()}
									</TableCell>
									<TableCell>
										{row.stayedToEnd ? (
											<Badge variant="secondary">Stayed to end</Badge>
										) : (
											<span className="text-xs text-muted-foreground">
												Left at {row.leftAt ? new Date(row.leftAt).toLocaleTimeString() : '—'}
											</span>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
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
		<TableHead>
			<button
				type="button"
				onClick={() => onClick(k)}
				className={`inline-flex items-center gap-1 text-left hover:text-foreground ${
					active ? 'text-foreground font-medium' : 'text-muted-foreground'
				}`}
			>
				{label}
				{active && <span className="text-xs">{asc ? '▲' : '▼'}</span>}
			</button>
		</TableHead>
	)
}
