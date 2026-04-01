/**
 * Fitted Ships Section - Grouped by location with expandable ships and fittings
 */

import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface FittedShipItem {
	slot: string
	typeId: string
	typeName: string
	quantity: number
}

interface FittedShip {
	shipName: string
	shipTypeId: string
	customName?: string
	locationName: string
	highs: FittedShipItem[]
	meds: FittedShipItem[]
	lows: FittedShipItem[]
	rigs: FittedShipItem[]
	subsystems: FittedShipItem[]
	drones: FittedShipItem[]
	cargo: FittedShipItem[]
	fuel: FittedShipItem[]
}

interface LocationGroup {
	locationName: string
	ships: FittedShip[]
}

function ShipIcon({ typeId }: { typeId: string }) {
	return (
		<img
			src={`https://images.evetech.net/types/${typeId}/icon?size=64`}
			alt=""
			className="h-10 w-10 rounded"
			loading="lazy"
		/>
	)
}

function SlotGroup({ label, items }: { label: string; items: FittedShipItem[] }) {
	if (items.length === 0) return null
	return (
		<div>
			<h6 className="text-xs font-semibold uppercase text-muted-foreground">{label}</h6>
			<ul className="mt-1 space-y-0.5">
				{items.map((item, i) => (
					<li key={`${item.typeId}-${i}`} className="flex items-center gap-1.5 text-sm">
						<img
							src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
							alt=""
							className="h-4 w-4 rounded"
							loading="lazy"
						/>
						<span className="text-foreground">{item.typeName}</span>
						{item.quantity > 1 && (
							<span className="text-muted-foreground">x{item.quantity}</span>
						)}
					</li>
				))}
			</ul>
		</div>
	)
}

function ShipCard({
	ship,
	isExpanded,
	onToggle,
}: {
	ship: FittedShip
	isExpanded: boolean
	onToggle: () => void
}) {
	const totalModules = [
		ship.highs,
		ship.meds,
		ship.lows,
		ship.rigs,
		ship.subsystems,
		ship.drones,
		ship.cargo,
		ship.fuel,
	].reduce((sum, arr) => sum + arr.length, 0)

	return (
		<div className="rounded-md border">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
			>
				{isExpanded ? (
					<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
				)}
				<ShipIcon typeId={ship.shipTypeId} />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="font-medium text-sm">{ship.shipName}</span>
						{ship.customName && (
							<span className="text-xs text-muted-foreground italic">
								"{ship.customName}"
							</span>
						)}
					</div>
					<span className="text-xs text-muted-foreground">
						{totalModules} module{totalModules !== 1 ? 's' : ''} fitted
					</span>
				</div>
			</button>

			{isExpanded && (
				<div className="border-t px-4 py-3">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						<SlotGroup label="High Slots" items={ship.highs} />
						<SlotGroup label="Mid Slots" items={ship.meds} />
						<SlotGroup label="Low Slots" items={ship.lows} />
						<SlotGroup label="Rigs" items={ship.rigs} />
						<SlotGroup label="Subsystems" items={ship.subsystems} />
						<SlotGroup label="Drones" items={ship.drones} />
						<SlotGroup label="Cargo" items={ship.cargo} />
						<SlotGroup label="Fuel" items={ship.fuel} />
					</div>
				</div>
			)}
		</div>
	)
}

export function FittedShipsSection({ data }: { data: FittedShip[] }) {
	const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
	const [expandedShips, setExpandedShips] = useState<Set<string>>(new Set())
	const [search, setSearch] = useState('')

	const groups = useMemo(() => {
		const filtered = search
			? data.filter((ship) => {
				const q = search.toLowerCase()
				return (
					ship.shipName.toLowerCase().includes(q) ||
					ship.customName?.toLowerCase().includes(q) ||
					ship.locationName.toLowerCase().includes(q)
				)
			})
			: data

		const map = new Map<string, FittedShip[]>()
		for (const ship of filtered) {
			const loc = ship.locationName || 'Unknown Location'
			const existing = map.get(loc)
			if (existing) {
				existing.push(ship)
			} else {
				map.set(loc, [ship])
			}
		}

		const result: LocationGroup[] = []
		for (const [locationName, ships] of map) {
			result.push({
				locationName,
				ships: ships.sort((a, b) => a.shipName.localeCompare(b.shipName)),
			})
		}
		return result.sort((a, b) => b.ships.length - a.ships.length)
	}, [data, search])

	const toggleLocation = (loc: string) => {
		setExpandedLocations((prev) => {
			const next = new Set(prev)
			if (next.has(loc)) {
				next.delete(loc)
			} else {
				next.add(loc)
			}
			return next
		})
	}

	const toggleShip = (key: string) => {
		setExpandedShips((prev) => {
			const next = new Set(prev)
			if (next.has(key)) {
				next.delete(key)
			} else {
				next.add(key)
			}
			return next
		})
	}

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No fitted ships found.</p>
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-4">
				<p className="text-sm text-muted-foreground">
					{data.length} fitted ship{data.length !== 1 ? 's' : ''} across {groups.length} location
					{groups.length !== 1 ? 's' : ''}
				</p>
				<div className="relative w-64">
					<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search ships or locations..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9 h-9"
					/>
				</div>
			</div>

			<div className="space-y-1">
				{groups.map((group) => {
					const isExpanded = expandedLocations.has(group.locationName)
					return (
						<div key={group.locationName}>
							<button
								type="button"
								onClick={() => toggleLocation(group.locationName)}
								className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
							>
								{isExpanded ? (
									<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<span className="font-medium text-sm flex-1 truncate">
									{group.locationName}
								</span>
								<span className="text-xs text-muted-foreground">
									{group.ships.length} ship{group.ships.length !== 1 ? 's' : ''}
								</span>
							</button>

							{isExpanded && (
								<div className="ml-6 space-y-2 py-1">
									{group.ships.map((ship, i) => {
										const shipKey = `${ship.shipTypeId}-${i}`
										return (
											<ShipCard
												key={shipKey}
												ship={ship}
												isExpanded={expandedShips.has(shipKey)}
												onToggle={() => toggleShip(shipKey)}
											/>
										)
									})}
								</div>
							)}
						</div>
					)
				})}

				{groups.length === 0 && search && (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No ships matching "{search}"
					</p>
				)}
			</div>
		</div>
	)
}
