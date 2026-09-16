/**
 * Orders Section - Active market orders grouped by location with collapsible
 * buy and sell subsections.
 */

import { ChevronDown, ChevronRight, Package, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
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
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'
import { typeIconUrl } from '@/lib/eve-images'

import type { Dispatch, SetStateAction } from 'react'

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
	expiresAt?: string
	state?: string
	min_volume?: number
	range: string
	duration: number
	escrow?: number
	region_id: string
	processedAt: string
}

type OrderSortField =
	| 'item'
	| 'price'
	| 'total'
	| 'remain'
	| 'issued'
	| 'expires'
	| 'state'
	| 'escrow'

function formatIsk(value: number): string {
	if (value >= 1_000_000_000)
		return i18n.t('hrpages.value1BIsk', { value1: (value / 1_000_000_000).toFixed(1) })
	if (value >= 1_000_000)
		return i18n.t('hrpages.value1MIsk', { value1: (value / 1_000_000).toFixed(1) })
	if (value >= 1_000) return i18n.t('hrpages.value1KIsk', { value1: (value / 1_000).toFixed(1) })
	return `${value.toLocaleString(getActiveLocale())} ISK`
}

function normalizeOrderState(state?: string): string {
	const normalized = String(state ?? 'active')
		.toLowerCase()
		.trim()
	if (!normalized || normalized === 'unknown' || normalized === 'open') {
		return 'active'
	}
	return normalized
}

function OrderStateBadge({ state }: { state?: string }) {
	const normalized = normalizeOrderState(state)
	if (normalized === 'active') {
		return (
			<Badge variant="success" className="text-[10px] capitalize">
				{normalized}
			</Badge>
		)
	}
	if (normalized === 'closed') {
		return (
			<Badge variant="destructive" className="text-[10px] capitalize">
				{normalized}
			</Badge>
		)
	}
	if (normalized === 'expired') {
		return (
			<Badge variant="warning" className="text-[10px] capitalize">
				{normalized}
			</Badge>
		)
	}
	if (normalized === 'cancelled') {
		return (
			<Badge variant="destructive" className="text-[10px] capitalize">
				{normalized}
			</Badge>
		)
	}
	return (
		<Badge variant="ghost" className="text-[10px] capitalize">
			{normalized}
		</Badge>
	)
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
	const { t } = useAppTranslation()

	const totalNotional = orders.reduce((sum, order) => sum + order.price * order.volume_remain, 0)
	const stateCounts = orders.reduce<Record<string, number>>((counts, order) => {
		const key = normalizeOrderState(order.state)
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
				case 'expires':
					return new Date(order.expiresAt ?? order.issued).getTime()
				case 'state':
					return normalizeOrderState(order.state)
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
	}, [orders, sortField, sortOrder, t])

	const SortableHead = ({
		field,
		label,
		alignRight = false,
	}: {
		field: OrderSortField
		label: string
		alignRight?: boolean
	}) => (
		<SortableTableHead
			className={alignRight ? 'text-right' : undefined}
			buttonClassName={alignRight ? 'w-full justify-end' : undefined}
			onSort={() => onSort(field)}
			direction={sortField === field ? sortOrder : undefined}
		>
			{label}
		</SortableTableHead>
	)

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<h4 className="text-sm font-semibold text-foreground">{title}</h4>
				<Badge variant="secondary">{orders.length}</Badge>
				{stateCounts.active && (
					<Badge variant="success" className="text-[10px] capitalize">
						{stateCounts.active}
						{t('hrpages.active2')}
					</Badge>
				)}
				{stateCounts.closed && (
					<Badge variant="ghost" className="text-[10px] capitalize">
						{stateCounts.closed}
						{t('hrpages.closed2')}
					</Badge>
				)}
				{stateCounts.expired && (
					<Badge variant="warning" className="text-[10px] capitalize">
						{stateCounts.expired}
						{t('hrpages.expired2')}
					</Badge>
				)}
				{stateCounts.cancelled && (
					<Badge variant="destructive" className="text-[10px] capitalize">
						{stateCounts.cancelled}
						{t('hrpages.cancelled2')}
					</Badge>
				)}
				<span className="text-xs text-muted-foreground">
					{t('hrpages.visibleNotional')}
					{formatIsk(totalNotional)}
				</span>
			</div>

			{orders.length === 0 ? (
				<p className="text-sm text-muted-foreground">{emptyLabel}</p>
			) : (
				<div className="overflow-x-auto rounded border">
					<Table>
						<TableHeader>
							<TableRow>
								<SortableHead field="item" label={t('hrpages.item')} />
								<SortableHead field="price" label={t('hrpages.price')} alignRight />
								<SortableHead field="total" label={t('hrpages.total')} alignRight />
								<SortableHead field="remain" label={t('hrpages.remain')} alignRight />
								<SortableHead field="issued" label={t('hrpages.issued')} />
								<SortableHead field="expires" label={t('hrpages.expires3')} />
								<SortableHead field="state" label={t('hrpages.status')} />
								{showEscrow && <TableHead className="text-right">{t('hrpages.escrow')}</TableHead>}
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
												<div className="text-xs text-muted-foreground">
													{t('hrpages.range')}
													{order.range}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell className="text-right font-mono">{formatIsk(order.price)}</TableCell>
									<TableCell className="text-right font-mono">
										{formatIsk(order.price * order.volume_total)}
									</TableCell>
									<TableCell className="text-right font-mono">
										{order.volume_remain.toLocaleString(getActiveLocale())}
									</TableCell>
									<TableCell>
										<EveTimeDisplay dateStr={order.issued} format="compact" />
									</TableCell>
									<TableCell>
										<EveTimeDisplay dateStr={order.expiresAt ?? order.issued} format="compact" />
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
	const { t } = useAppTranslation()

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
				normalizeOrderState(order.state),
				order.is_buy_order ? 'buy' : 'sell',
			]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(q))
		})
	}, [data, search, t])

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
	}, [filtered, t])

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
		setOrder: Dispatch<SetStateAction<'asc' | 'desc'>>
	) => {
		return (field: OrderSortField) => {
			if (currentField === field) {
				setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
				return
			}
			setField(field)
			setOrder(field === 'issued' || field === 'expires' || field === 'state' ? 'desc' : 'asc')
		}
	}

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noMarketOrdersFound')}</p>
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative w-full max-w-sm">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={t('hrpages.searchOrders')}
						className="pl-9"
					/>
				</div>
				<Badge variant="secondary">
					{totalVisible}
					{t('hrpages.visible')}
				</Badge>
			</div>

			<div className="space-y-2">
				{groups.map((group) => {
					const isExpanded = expandedLocations.has(group.locationKey)
					const totalOrders = group.buyOrders.length + group.sellOrders.length
					const totalNotional = [...group.buyOrders, ...group.sellOrders].reduce(
						(sum, order) => sum + order.price * order.volume_remain,
						0
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
									{t('hrpages.orderCount', { count: totalOrders })}
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
										title={t('hrpages.buyOrders')}
										orders={group.buyOrders}
										emptyLabel={t('hrpages.noBuyOrdersMatchedTheCurrentFilters')}
										showEscrow
										sortField={buySortField}
										sortOrder={buySortOrder}
										onSort={makeSortHandler(buySortField, setBuySortField, setBuySortOrder)}
									/>
									<OrderTable
										title={t('hrpages.sellOrders')}
										orders={group.sellOrders}
										emptyLabel={t('hrpages.noSellOrdersMatchedTheCurrentFilters')}
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
