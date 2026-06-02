/**
 * Orders Section - Active market orders grouped by location with collapsible
 * buy and sell subsections.
 */

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Package, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { typeIconUrl } from '@/lib/eve-images'

interface ProcessedMarketOrder {
	order_id: string
	type_id: string
	typeName?: string
	location_id: string
	locationName?: string
	price: number
	volume_total: number
	volume_remain: number
	is_buy_order: boolean
	issued: string
	state: string
	min_volume?: number
	range: string
	duration: number
	escrow?: number
	region_id: string
	processedAt: string
}

type OrderSortField = 'item' | 'price' | 'total' | 'remain' | 'issued' | 'state' | 'escrow'

function formatIsk(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B ISK`
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ISK`
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K ISK`
	return `${value.toLocaleString()} ISK`
}

function OrderStateBadge({ state }: { state: string }) {
	const normalized = state.toLowerCase()
	if (normalized === 'open') {
		return <Badge variant="success" className="text-[10px] capitalize">{state}</Badge>
	}
	if (normalized === 'closed') {
		return <Badge variant="secondary" className="text-[10px] capitalize">{state}</Badge>
	}
	if (normalized === 'expired') {
		return <Badge variant="warning" className="text-[10px] capitalize">{state}</Badge>
	}
	if (normalized === 'cancelled') {
		return <Badge variant="destructive" className="text-[10px] capitalize">{state}</Badge>
	}
	return <Badge variant="secondary" className="text-[10px] capitalize">{state}</Badge>
}

function OrderIcon({ typeId }: { typeId: string }) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return (
			<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
				<Package className="h-4 w-4 text-muted-foreground" />
			</div>
		)
	}

	return (
		<img
			src={typeIconUrl(typeId, 64)}
			alt=""
			className="h-10 w-10 shrink-0 rounded object-cover"
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	)
}

function compareStrings(a?: string, b?: string): number {
	return (a ?? '').localeCompare(b ?? '')
}

function OrderTable({
	title,
	orders,
	emptyLabel,
	showEscrow,
	sortField,
	sortOrder,
	onSort,
}: {
	title: string
	orders: ProcessedMarketOrder[]
	emptyLabel: string
	showEscrow: boolean
	sortField: OrderSortField
	sortOrder: 'asc' | 'desc'
	onSort: (field: OrderSortField) => void
}) {
	const totalNotional = orders.reduce((sum, order) => sum + order.price * order.volume_remain, 0)
	const stateCounts = orders.reduce<Record<string, number>>((counts, order) => {
		const key = order.state.toLowerCase()
		counts[key] = (counts[key] ?? 0) + 1
		return counts
	}, {})

	const sortedOrders = useMemo(() => {
		const direction = sortOrder === 'asc' ? 1 : -1
		const valueFor = (order: ProcessedMarketOrder) => {
			switch (sortField) {
				case 'item':
					return order.typeName || order.type_id
				case 'price':
					return order.price
				case 'total':
					return order.price * order.volume_total
				case 'remain':
					return order.volume_remain
				case 'issued':
					return new Date(order.issued).getTime()
				case 'state':
					return order.state
				case 'escrow':
					return order.escrow ?? -1
			}
		}

		return [...orders].sort((a, b) => {
			const aValue = valueFor(a)
			const bValue = valueFor(b)
			if (typeof aValue === 'number' && typeof bValue === 'number') {
				if (aValue !== bValue) return (aValue - bValue) * direction
			} else {
				const diff = compareStrings(String(aValue), String(bValue))
				if (diff !== 0) return diff * direction
			}

			return compareStrings(a.typeName || a.type_id, b.typeName || b.type_id)
		})
	}, [orders, sortField, sortOrder])

	const renderSortIcon = (field: OrderSortField) => {
		if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
		return sortOrder === 'asc' ? (
			<ArrowUp className="h-3 w-3 text-muted-foreground" />
		) : (
			<ArrowDown className="h-3 w-3 text-muted-foreground" />
		)
	}

	const SortableHead = ({ field, label, alignRight = false }: { field: OrderSortField; label: string; alignRight?: boolean }) => (
		<TableHead className={alignRight ? 'text-right' : undefined}>
			<button
				type="button"
				onClick={() => onSort(field)}
				className={`inline-flex items-center gap-1.5 ${alignRight ? 'justify-end' : ''}`}
			>
				<span>{label}</span>
				{renderSortIcon(field)}
			</button>
		</TableHead>
	)

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<h4 className="text-sm font-semibold text-foreground">{title}</h4>
				<Badge variant="secondary">{orders.length}</Badge>
				{stateCounts.open && <Badge variant="success" className="text-[10px] capitalize">{stateCounts.open} open</Badge>}
				{stateCounts.closed && <Badge variant="secondary" className="text-[10px] capitalize">{stateCounts.closed} closed</Badge>}
				{stateCounts.expired && <Badge variant="warning" className="text-[10px] capitalize">{stateCounts.expired} expired</Badge>}
				{stateCounts.cancelled && <Badge variant="destructive" className="text-[10px] capitalize">{stateCounts.cancelled} cancelled</Badge>}
				<span className="text-xs text-muted-foreground">
					Visible notional: {formatIsk(totalNotional)}
				</span>
			</div>

			{orders.length === 0 ? (
				<p className="text-sm text-muted-foreground">{emptyLabel}</p>
			) : (
				<div className="overflow-x-auto rounded border">
					<Table>
						<TableHeader>
							<TableRow>
								<SortableHead field="item" label="Item" />
								<SortableHead field="price" label="Price" alignRight />
								<SortableHead field="total" label="Total" alignRight />
								<SortableHead field="remain" label="Remain" alignRight />
								<SortableHead field="issued" label="Issued" />
								<SortableHead field="state" label="Status" />
								{showEscrow && <TableHead className="text-right">Escrow</TableHead>}
							</TableRow>
						</TableHeader>
						<TableBody>
							{sortedOrders.map((order) => (
								<TableRow key={order.order_id}>
									<TableCell className="font-medium">
										<div className="flex items-start gap-3">
											<OrderIcon typeId={order.type_id} />
											<div className="min-w-0 space-y-0.5">
												<div className="truncate">{order.typeName || order.type_id}</div>
												<div className="flex flex-wrap items-center gap-1.5">
													<Badge
														variant={order.is_buy_order ? 'success' : 'destructive'}
														className="text-[10px]"
													>
														{order.is_buy_order ? 'Buy' : 'Sell'}
													</Badge>
													<OrderStateBadge state={order.state} />
													<span className="text-xs text-muted-foreground">{order.range}</span>
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell className="text-right font-mono">{formatIsk(order.price)}</TableCell>
									<TableCell className="text-right font-mono">
										{formatIsk(order.price * order.volume_total)}
									</TableCell>
									<TableCell className="text-right font-mono">
										{order.volume_remain.toLocaleString()}
									</TableCell>
									<TableCell>
										<EveTimeDisplay dateStr={order.issued} format="compact" />
										<div className="text-xs text-muted-foreground">{order.duration}d</div>
									</TableCell>
									<TableCell>
										<OrderStateBadge state={order.state} />
									</TableCell>
									{showEscrow && (
										<TableCell className="text-right font-mono">
											{typeof order.escrow === 'number' ? formatIsk(order.escrow) : '-'}
										</TableCell>
									)}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	)
}

interface LocationGroup {
	locationKey: string
	locationName: string
	buyOrders: ProcessedMarketOrder[]
	sellOrders: ProcessedMarketOrder[]
}

export function OrdersSection({ data }: { data: ProcessedMarketOrder[] }) {
	const [search, setSearch] = useState('')
	const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
	const [buySortField, setBuySortField] = useState<OrderSortField>('price')
	const [buySortOrder, setBuySortOrder] = useState<'asc' | 'desc'>('desc')
	const [sellSortField, setSellSortField] = useState<OrderSortField>('price')
	const [sellSortOrder, setSellSortOrder] = useState<'asc' | 'desc'>('desc')

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase()
		if (!q) return data
		return data.filter((order) => {
			return [
				order.typeName,
				order.type_id,
				order.locationName,
				order.location_id,
				order.range,
				order.state,
				order.is_buy_order ? 'buy' : 'sell',
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(q))
		})
	}, [data, search])

	const groups = useMemo(() => {
		const map = new Map<string, LocationGroup>()

		for (const order of filtered) {
			const locationKey = order.location_id
			const locationName = order.locationName || order.location_id
			const existing = map.get(locationKey)
			if (existing) {
				if (order.is_buy_order) {
					existing.buyOrders.push(order)
				} else {
					existing.sellOrders.push(order)
				}
				continue
			}

			map.set(locationKey, {
				locationKey,
				locationName,
				buyOrders: order.is_buy_order ? [order] : [],
				sellOrders: order.is_buy_order ? [] : [order],
			})
		}

		return [...map.values()]
			.map((group) => ({
				...group,
				buyOrders: group.buyOrders.sort((a, b) => b.price - a.price),
				sellOrders: group.sellOrders.sort((a, b) => b.price - a.price),
			}))
			.sort((a, b) => {
				const aCount = a.buyOrders.length + a.sellOrders.length
				const bCount = b.buyOrders.length + b.sellOrders.length
				if (bCount !== aCount) return bCount - aCount
				return a.locationName.localeCompare(b.locationName)
			})
	}, [filtered])

	const totalVisible = filtered.length

	const toggleLocation = (locationKey: string) => {
		setExpandedLocations((prev) => {
			const next = new Set(prev)
			if (next.has(locationKey)) {
				next.delete(locationKey)
			} else {
				next.add(locationKey)
			}
			return next
		})
	}

	const makeSortHandler = (
		currentField: OrderSortField,
		setField: Dispatch<SetStateAction<OrderSortField>>,
		setOrder: Dispatch<SetStateAction<'asc' | 'desc'>>,
	) => {
		return (field: OrderSortField) => {
			if (currentField === field) {
				setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
				return
			}
			setField(field)
			setOrder(field === 'issued' || field === 'state' ? 'desc' : 'asc')
		}
	}

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No market orders found.</p>
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative w-full max-w-sm">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search orders..."
						className="pl-9"
					/>
				</div>
				<Badge variant="secondary">{totalVisible} visible</Badge>
			</div>

			<div className="space-y-2">
				{groups.map((group) => {
					const isExpanded = expandedLocations.has(group.locationKey)
					const totalOrders = group.buyOrders.length + group.sellOrders.length
					const totalNotional = [...group.buyOrders, ...group.sellOrders].reduce(
						(sum, order) => sum + order.price * order.volume_remain,
						0,
					)

					return (
						<div key={group.locationKey} className="rounded-md border">
							<button
								type="button"
								onClick={() => toggleLocation(group.locationKey)}
								className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
							>
								{isExpanded ? (
									<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<span className="min-w-0 flex-1 truncate font-medium text-sm">
									{group.locationName}
								</span>
								<span className="text-xs text-muted-foreground">
									{totalOrders} order{totalOrders !== 1 ? 's' : ''}
								</span>
								{totalNotional > 0 && (
									<span className="text-xs font-medium text-amber-400">
										{formatIsk(totalNotional)}
									</span>
								)}
							</button>

							{isExpanded && (
								<div className="border-t px-4 py-3 space-y-4">
									<OrderTable
										title="Buy Orders"
										orders={group.buyOrders}
										emptyLabel="No buy orders matched the current filters."
										showEscrow
										sortField={buySortField}
										sortOrder={buySortOrder}
										onSort={makeSortHandler(buySortField, setBuySortField, setBuySortOrder)}
									/>
									<OrderTable
										title="Sell Orders"
										orders={group.sellOrders}
										emptyLabel="No sell orders matched the current filters."
										showEscrow={false}
										sortField={sellSortField}
										sortOrder={sellSortOrder}
										onSort={makeSortHandler(sellSortField, setSellSortField, setSellSortOrder)}
									/>
								</div>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
