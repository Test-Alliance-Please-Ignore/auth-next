import { ChevronDown } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'

import { SYSTEM_WALLET_USER_ID } from '@repo/prediction-markets'

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
import { formatPoints } from '@/lib/format-utils'
import { cn } from '@/lib/utils'

import type { AdminLedgerRow, LedgerType } from '../types'
import type { BadgeVariant } from '@/components/ui/badge'

const LEDGER_TYPE_VARIANTS: Record<LedgerType, BadgeVariant> = {
	grant: 'success',
	wager: 'warning',
	refund: 'secondary',
	payout: 'gold',
	rake: 'special',
	burn: 'destructive',
	adjustment: 'ghost',
}

const COL_COUNT = 8

function hasMetadata(metadata: unknown): boolean {
	return (
		metadata != null &&
		(typeof metadata !== 'object' || Object.keys(metadata as object).length > 0)
	)
}

export interface LedgerTableProps {
	rows: AdminLedgerRow[] | undefined
	isLoading: boolean
	error: Error | null
}

/** Append-only financial ledger table. Amounts are signed integer strings (display only). */
export function LedgerTable({ rows, isLoading, error }: LedgerTableProps) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const toggle = (id: string) =>
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})

	if (error) {
		return <p className="text-destructive">Failed to load ledger: {error.message}</p>
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
						<TableHead>Type</TableHead>
						<TableHead className="text-right">Amount</TableHead>
						<TableHead className="text-right">Balance After</TableHead>
						<TableHead>User</TableHead>
						<TableHead>Market / Bet</TableHead>
						<TableHead>Key</TableHead>
						<TableHead className="w-10" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows?.map((row) => {
						const isOpen = expanded.has(row.id)
						const meta = hasMetadata(row.metadata)
						const negative = row.amount.trim().startsWith('-')
						return (
							<Fragment key={row.id}>
								<TableRow>
									<TableCell className="whitespace-nowrap text-xs text-muted-foreground">
										{formatDateTime(row.createdAt)}
									</TableCell>
									<TableCell>
										<Badge variant={LEDGER_TYPE_VARIANTS[row.type]}>{row.type}</Badge>
									</TableCell>
									<TableCell className="text-right font-mono">
										<span className={negative ? 'text-red-500' : 'text-green-500'}>
											{formatPoints(row.amount)}
										</span>
									</TableCell>
									<TableCell className="text-right font-mono text-muted-foreground">
										{row.balanceAfter != null ? formatPoints(row.balanceAfter) : '—'}
									</TableCell>
									<TableCell>
										{/* Nil-UUID system wallet renders as a plain "System" label, not a broken user link. */}
										{row.userId && row.userId !== SYSTEM_WALLET_USER_ID ? (
											<Link
												to={`/admin/users/${row.userId}`}
												className="flex items-center gap-2 text-primary hover:underline"
											>
												{row.mainCharacterId ? (
													<img
														src={characterPortraitUrl(row.mainCharacterId, 32)}
														alt=""
														className="h-6 w-6 rounded-full"
													/>
												) : null}
												<span className="text-sm">{row.userName ?? row.userId}</span>
											</Link>
										) : (
											<span className="text-sm italic text-muted-foreground">System</span>
										)}
									</TableCell>
									<TableCell className="font-mono text-xs text-muted-foreground">
										{row.marketId ? <div>mkt: {row.marketId.slice(0, 8)}…</div> : null}
										{row.betId ? <div>bet: {row.betId.slice(0, 8)}…</div> : null}
										{!row.marketId && !row.betId ? '—' : null}
									</TableCell>
									<TableCell
										className="max-w-[10rem] truncate font-mono text-xs text-muted-foreground"
										title={row.idempotencyKey ?? undefined}
									>
										{row.idempotencyKey ?? '—'}
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
								No ledger entries found
							</TableCell>
						</TableRow>
					) : null}
				</TableBody>
			</Table>
		</div>
	)
}
