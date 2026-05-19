import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatDurationBetween } from '../utils/format'

import type { SessionCurrentMember, SessionGroupCount } from '../types'

interface CurrentMembersPanelProps {
	sessionId: string
	members: SessionCurrentMember[]
	groupCounts: SessionGroupCount[]
}

export function CurrentMembersPanel({
	sessionId,
	members,
	groupCounts,
}: CurrentMembersPanelProps) {
	const [query, setQuery] = useState('')
	const trimmed = query.trim().toLowerCase()

	const filteredMembers = useMemo(() => {
		if (!trimmed) return members
		return members.filter((m) => {
			const fields = [
				m.characterName,
				m.shipTypeName,
				m.groupName,
				m.systemName,
			]
			return fields.some((f) => f?.toLowerCase().includes(trimmed))
		})
	}, [members, trimmed])

	return (
		<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
			<div className="lg:col-span-2">
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between gap-3 flex-wrap">
							<CardTitle className="text-base">
								Current members{' '}
								<span className="text-muted-foreground font-normal">
									{trimmed && filteredMembers.length !== members.length
										? `(${filteredMembers.length} of ${members.length})`
										: `(${members.length})`}
								</span>
							</CardTitle>
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search pilot, ship, system…"
								className="max-w-xs"
							/>
						</div>
					</CardHeader>
					<CardContent className="p-0">
						{members.length === 0 ? (
							<div className="py-8 text-center text-sm text-muted-foreground">
								No members in fleet right now.
							</div>
						) : filteredMembers.length === 0 ? (
							<div className="py-8 text-center text-sm text-muted-foreground">
								No members match "{query}".
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Pilot</TableHead>
										<TableHead>Ship</TableHead>
										<TableHead>Group</TableHead>
										<TableHead>System</TableHead>
										<TableHead>In ship</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{filteredMembers.map((m) => (
										<TableRow key={m.characterId}>
											<TableCell>
												<Link
													to={`/fleet-tracking/${sessionId}/members/${m.characterId}`}
													className="hover:underline"
												>
													{m.characterName ?? m.characterId}
												</Link>
											</TableCell>
											<TableCell>{m.shipTypeName ?? `type #${m.shipTypeId}`}</TableCell>
											<TableCell className="text-muted-foreground">
												{m.groupName ?? '—'}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{m.systemName ?? `system #${m.solarSystemId}`}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{formatDurationBetween(m.sinceTime, null)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</div>

			<div>
				<Card>
					<CardHeader>
						<CardTitle className="text-base">By ship class</CardTitle>
					</CardHeader>
					<CardContent>
						{groupCounts.length === 0 ? (
							<div className="text-sm text-muted-foreground py-4">No ships in fleet right now.</div>
						) : (
							<ul className="space-y-1.5">
								{groupCounts.map((g) => {
									const max = Math.max(...groupCounts.map((x) => x.count), 1)
									const pct = (g.count / max) * 100
									return (
										<li key={g.groupId} className="text-sm">
											<div className="flex items-baseline justify-between gap-2">
												<span>{g.groupName ?? 'Unknown'}</span>
												<span className="text-muted-foreground font-mono text-xs">
													{g.count}
												</span>
											</div>
											<div className="h-1.5 mt-1 bg-muted rounded">
												<div
													className="h-full bg-primary rounded"
													style={{ width: `${pct}%` }}
												/>
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
