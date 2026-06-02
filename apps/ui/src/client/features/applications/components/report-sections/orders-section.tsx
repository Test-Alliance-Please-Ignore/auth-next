/**
 * Orders Section - Active market orders grouped by buy/sell side
 */

import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

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

function formatIsk(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B ISK`
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ISK`
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K ISK`
	return `${value.toLocaleString()} ISK`
}

function OrderTable({
	title,
	orders,
	emptyLabel,
}: {
	title: string
	orders: ProcessedMarketOrder[]
	emptyLabel: string
}) {
	const totalNotional = orders.reduce((sum, order) => sum + order.price * order.volume_remain, 0)

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<h4 className="text-sm font-semibold text-foreground">{title}</h4>
				<Badge variant="secondary">{orders.length}</Badge>
				<span className="text-xs text-muted-foreground">
					Open notional: {formatIsk(totalNotional)}
				</span>
			</div>

			{orders.length === 0 ? (
				<p className="text-sm text-muted-foreground">{emptyLabel}</p>
			) : (
				<div className="overflow-x-auto rounded border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Item</TableHead>
								<TableHead>Location</TableHead>
								<TableHead className="text-right">Price</TableHead>
								<TableHead className="text-right">Total</TableHead>
								<TableHead className="text-right">Remain</TableHead>
								<TableHead>Issued</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Escrow</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{orders.map((order) => (
								<TableRow key={order.order_id}>
									<TableCell className="font-medium">
										<div className="space-y-0.5">
											<div>{order.typeName || order.type_id}</div>
											<div className="text-xs font-mono text-muted-foreground">
												{order.type_id}
											</div>
											<div className="flex flex-wrap items-center gap-1.5 pt-0.5">
												<Badge variant={order.is_buy_order ? 'success' : 'destructive'} className="text-[10px]">
													{order.is_buy_order ? 'Buy' : 'Sell'}
												</Badge>
												<span className="text-xs text-muted-foreground">
													{order.range}
												</span>
											</div>
										</div>
									</TableCell>
									<TableCell>
										<div className="space-y-0.5">
											<div className="max-w-[240px] truncate">{order.locationName || order.location_id}</div>
											<div className="text-xs font-mono text-muted-foreground">
												{order.location_id}
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
										<Badge variant="secondary" className="capitalize">
											{order.state}
										</Badge>
									</TableCell>
									<TableCell className="text-right font-mono">
										{typeof order.escrow === 'number' ? formatIsk(order.escrow) : '-'}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	)
}

export function OrdersSection({ data }: { data: ProcessedMarketOrder[] }) {
	const [search, setSearch] = useState('')

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

	const buyOrders = useMemo(
		() => filtered.filter((order) => order.is_buy_order).sort((a, b) => b.price - a.price),
		[filtered],
	)
	const sellOrders = useMemo(
		() => filtered.filter((order) => !order.is_buy_order).sort((a, b) => b.price - a.price),
		[filtered],
	)

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No active market orders found.</p>
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
				<Badge variant="secondary">{filtered.length} visible</Badge>
			</div>

			<OrderTable
				title="Buy Orders"
				orders={buyOrders}
				emptyLabel="No buy orders matched the current filters."
			/>
			<OrderTable
				title="Sell Orders"
				orders={sellOrders}
				emptyLabel="No sell orders matched the current filters."
			/>
		</div>
	)
}
