import { ArrowRight, ChevronDown } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'

import { JsonViewer } from '@/components/json-viewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/date-utils'
import { characterPortraitUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

import type { AdminMarketHistoryRow, MarketStatus } from '../types'
import type { BadgeVariant } from '@/components/ui/badge'

const VISIBILITY_VARIANTS: Record<'public' | 'internal', BadgeVariant> = {
	public: 'secondary',
	internal: 'warning',
}

function statusVariant(status: MarketStatus | null): BadgeVariant {
	switch (status) {
		case 'open':
			return 'success'
		case 'closed':
		case 'resolving':
			return 'warning'
		case 'resolved':
			return 'gold'
		case 'voided':
			return 'destructive'
		case 'draft':
			return 'secondary'
		default:
			return 'ghost'
	}
}

const COL_COUNT = 6

function hasMetadata(metadata: unknown): boolean {
	return (
		metadata != null &&
		(typeof metadata !== 'object' || Object.keys(metadata as object).length > 0)
	)
}

export interface MarketHistoryTableProps {
	rows: AdminMarketHistoryRow[] | undefined
	isLoading: boolean
	error: Error | null
}

/** Immutable market-lifecycle audit table. */
export function MarketHistoryTable({ rows, isLoading, error }: MarketHistoryTableProps) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const toggle = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})

	if (error) {
		return <p className="text-destructive">Failed to load market history: {error.message}</p>
	}
	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		)
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Created</TableHead>
						<TableHead>Actor</TableHead>
						<TableHead>Action</TableHead>
						<TableHead>Transition</TableHead>
						<TableHead>Visibility</TableHead>
						<TableHead className="w-10" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows?.map((row) => {
						const isOpen = expanded.has(row.id)
						const meta = hasMetadata(row.metadata)
						return (
							<Fragment key={row.id}>
								<TableRow>
									<TableCell className="whitespace-nowrap text-xs text-muted-foreground">
										{formatDateTime(row.createdAt)}
									</TableCell>
									<TableCell>
										{row.actorUserId && row.actor ? (
											<Link
												to={`/admin/users/${row.actorUserId}`}
												className="flex items-center gap-2 text-primary hover:underline"
											>
												{row.actor.mainCharacterId ? (
													<img
														src={characterPortraitUrl(row.actor.mainCharacterId, 32)}
														alt=""
														className="h-6 w-6 rounded-full"
													/>
												) : null}
												<span className="text-sm">{row.actor.userName ?? row.actorUserId}</span>
											</Link>
										) : (
											<span className="text-sm italic text-muted-foreground">System</span>
										)}
									</TableCell>
									<TableCell>
										<Badge variant="default">{row.action}</Badge>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-1.5">
											{row.previousStatus ? (
												<Badge variant={statusVariant(row.previousStatus)}>
													{row.previousStatus}
												</Badge>
											) : (
												<span className="text-xs text-muted-foreground">—</span>
											)}
											<ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
											{row.newStatus ? (
												<Badge variant={statusVariant(row.newStatus)}>{row.newStatus}</Badge>
											) : (
												<span className="text-xs text-muted-foreground">—</span>
											)}
										</div>
									</TableCell>
									<TableCell>
										<Badge variant={VISIBILITY_VARIANTS[row.visibility]}>{row.visibility}</Badge>
									</TableCell>
									<TableCell>
										{meta ? (
											<Button variant="ghost" size="sm" onClick={() => toggle(row.id)}>
												<ChevronDown
													className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
												/>
											</Button>
										) : null}
									</TableCell>
								</TableRow>
								{isOpen && meta ? (
									<TableRow>
										<TableCell colSpan={COL_COUNT} className="bg-muted/30">
											<div className="mb-2 text-sm font-medium">Metadata</div>
											<JsonViewer data={row.metadata} defaultExpanded={false} maxHeight="300px" />
										</TableCell>
									</TableRow>
								) : null}
							</Fragment>
						)
					})}
					{rows?.length === 0 ? (
						<TableRow>
							<TableCell colSpan={COL_COUNT} className="h-24 text-center text-muted-foreground">
								No history entries found
							</TableCell>
						</TableRow>
					) : null}
				</TableBody>
			</Table>
		</div>
	)
}
