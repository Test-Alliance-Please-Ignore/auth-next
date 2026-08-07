/**
 * Fitted Ships Section - Grouped by location with expandable ships and fittings
 */

import { ChevronDown, ChevronRight, Package, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { typeIconUrl, typeImageUrl } from '@/lib/eve-images'
import { cn } from '@/lib/utils'

interface FittedShipItem {
	slot: string
	typeId: string
	typeName: string
	quantity: number
}

interface FittedShipBay {
	bayName: string
	items: FittedShipItem[]
}

interface FittedShip {
	itemId?: string
	shipName: string
	shipTypeId: string
	shipGroupId?: string
	customName?: string
	locationName: string
	estimatedValue?: number
	highs: FittedShipItem[]
	meds: FittedShipItem[]
	lows: FittedShipItem[]
	rigs: FittedShipItem[]
	subsystems: FittedShipItem[]
	drones: FittedShipItem[]
	cargo: FittedShipItem[]
	fuel: FittedShipItem[]
	fighters: FittedShipItem[]
	fighterBay: FittedShipItem[]
	shipsInSmb: FittedShipItem[]
	fleetHangar: FittedShipItem[]
	specializedBays?: FittedShipBay[]
	containedShips?: FittedShip[]
}

interface LocationGroup {
	locationName: string
	ships: FittedShip[]
	estimatedValue: number
}

type ShipSortMode = 'value' | 'class' | 'name'
const SHIP_SORT_OPTIONS = [
	{ value: 'value', label: 'Sort: Value' },
	{ value: 'class', label: 'Sort: Ship Class' },
	{ value: 'name', label: 'Sort: Name' },
] as const

function formatIsk(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B ISK`
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ISK`
	if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ISK`
	return `${value.toLocaleString()} ISK`
}

const SHIP_GROUP_CLASS_RANK: Record<string, number> = {
	// Titans (100s)
	'30': 100,
	// Supercarriers (90s)
	'659': 90,
	// Carriers / Dreads / FAX (80s)
	'547': 80,
	'485': 80,
	'4594': 80,
	'1538': 80,
	// Freighters / Jump Freighters (70s)
	'513': 70,
	'902': 70,
	// Industrials / Mining / Transport / Industrial Command (60s)
	'28': 60,
	'380': 60,
	'1202': 60,
	'941': 60,
	'883': 60,
	'463': 60,
	'543': 60,
	'4902': 60,
	// Battleships / Elite / Marauder / Black Ops (50s)
	'27': 50,
	'381': 50,
	'900': 50,
	'898': 50,
	// Battlecruisers / Attack BC / Command Ships (40s)
	'419': 40,
	'1201': 40,
	'540': 40,
	// Cruisers (30s)
	'26': 30,
	'358': 30,
	'963': 30,
	'906': 30,
	'833': 30,
	'832': 30,
	'894': 30,
	'1972': 30,
	// Destroyers / Tactical / Command / Interdictor (20s)
	'420': 20,
	'1305': 20,
	'1534': 20,
	'541': 20,
	// Frigates / Corvette / Specialty frigate hulls (10s)
	'25': 10,
	'324': 10,
	'831': 10,
	'830': 10,
	'834': 10,
	'893': 10,
	'1283': 10,
	'1527': 10,
	'237': 10,
	'1022': 10,
	// Shuttles / yacht class utility hulls (0-10s)
	'31': 5,
	'5087': 5,
}

function getShipClassRank(shipGroupId?: string): number {
	if (!shipGroupId) return 10
	return SHIP_GROUP_CLASS_RANK[shipGroupId] ?? 10
}

function ShipIcon({ typeId }: { typeId: string }) {
	return <img src={typeIconUrl(typeId, 64)} alt="" className="h-10 w-10 rounded" loading="lazy" />
}

function SlotItemIcon({ typeId, typeName }: { typeId: string; typeName: string }) {
	const [failed, setFailed] = useState(false)

	if (failed) {
		return (
			<div className="h-4 w-4 shrink-0 rounded bg-muted flex items-center justify-center">
				<Package className="h-3 w-3 text-muted-foreground" />
			</div>
		)
	}

	const name = typeName.toLowerCase()
	let variant = 'icon'
	if (name.includes('blueprint')) {
		variant = name.includes('copy') ? 'bpc' : 'bp'
	}

	return (
		<img
			src={typeImageUrl(typeId, variant, 32)}
			alt=""
			className="h-4 w-4 shrink-0 rounded"
			loading="lazy"
			onError={() => setFailed(true)}
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
						<SlotItemIcon typeId={item.typeId} typeName={item.typeName} />
						<span className="text-foreground">{item.typeName}</span>
						{item.quantity > 1 && <span className="text-muted-foreground">x{item.quantity}</span>}
					</li>
				))}
			</ul>
		</div>
	)
}

function ShipCard({
	ship,
	isExpanded,
	onToggleShip,
	expandedShips,
	depth = 0,
}: {
	ship: FittedShip
	isExpanded: boolean
	onToggleShip: (shipKey: string) => void
	expandedShips: Set<string>
	depth?: number
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
		ship.fighters,
		ship.fighterBay,
		ship.shipsInSmb,
		ship.fleetHangar,
		...(ship.specializedBays?.map((b) => b.items) ?? []),
	].reduce((sum, arr) => sum + arr.length, 0)

	return (
		<div className={cn('rounded-md border', depth > 0 && 'ml-4')}>
			<button
				type="button"
				onClick={() => onToggleShip(ship.itemId || ship.shipTypeId)}
				className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
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
							<span className="text-xs text-muted-foreground italic">"{ship.customName}"</span>
						)}
					</div>
					<span className="text-xs text-muted-foreground">
						{totalModules} module{totalModules !== 1 ? 's' : ''} fitted
					</span>
				</div>
				{ship.estimatedValue != null && ship.estimatedValue > 0 && (
					<span className="text-xs font-medium text-amber-400 shrink-0">
						{formatIsk(ship.estimatedValue)}
					</span>
				)}
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
						<SlotGroup label="Fuel Bay" items={ship.fuel} />
						<SlotGroup label="Fighters" items={ship.fighters} />
						<SlotGroup label="Fighter Bay" items={ship.fighterBay} />
						<SlotGroup label="Ship Maintenance Bay" items={ship.shipsInSmb} />
						<SlotGroup label="Fleet Hangar" items={ship.fleetHangar} />
						{ship.specializedBays?.map((bay) => (
							<SlotGroup key={bay.bayName} label={bay.bayName} items={bay.items} />
						))}
					</div>
					{ship.containedShips && ship.containedShips.length > 0 && (
						<div className="mt-4 space-y-2">
							<h6 className="text-xs font-semibold uppercase text-muted-foreground">
								Contained Ships
							</h6>
							<div className="space-y-2">
								{ship.containedShips.map((containedShip) => (
									<ShipCard
										key={
											containedShip.itemId ??
											`${containedShip.shipTypeId}-${containedShip.shipName}`
										}
										ship={containedShip}
										isExpanded={expandedShips.has(containedShip.itemId || containedShip.shipTypeId)}
										onToggleShip={onToggleShip}
										expandedShips={expandedShips}
										depth={depth + 1}
									/>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

function collectShipKeys(ship: FittedShip): string[] {
	const key = ship.itemId || ship.shipTypeId
	return [key, ...(ship.containedShips?.flatMap(collectShipKeys) ?? [])]
}

export function FittedShipsSection({ data }: { data: FittedShip[] }) {
	const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
	const [expandedShips, setExpandedShips] = useState<Set<string>>(new Set())
	const [search, setSearch] = useState('')
	const [sortMode, setSortMode] = useState<ShipSortMode>('value')

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
			const sortedShips = [...ships]
			if (sortMode === 'value') {
				sortedShips.sort((a, b) => (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0))
			} else if (sortMode === 'class') {
				sortedShips.sort((a, b) => {
					const classDiff = getShipClassRank(b.shipGroupId) - getShipClassRank(a.shipGroupId)
					if (classDiff !== 0) return classDiff
					return (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0)
				})
			} else {
				sortedShips.sort((a, b) => a.shipName.localeCompare(b.shipName))
			}
			result.push({
				locationName,
				ships: sortedShips,
				estimatedValue: ships.reduce((sum, s) => sum + (s.estimatedValue ?? 0), 0),
			})
		}
		return result.sort((a, b) => b.ships.length - a.ships.length)
	}, [data, search, sortMode])

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
					{(() => {
						const total = groups.reduce((sum, g) => sum + g.estimatedValue, 0)
						return total > 0 ? (
							<span className="text-amber-400 font-medium"> — {formatIsk(total)} total</span>
						) : null
					})()}
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
				<div className="flex items-center gap-2">
					<Select
						value={sortMode}
						onValueChange={(value) => setSortMode(value as ShipSortMode)}
						options={[...SHIP_SORT_OPTIONS]}
						placeholder="Sort: Value"
						className="w-36"
					/>
					<button
						type="button"
						onClick={() => {
							setExpandedLocations(new Set(groups.map((group) => group.locationName)))
							setExpandedShips(
								new Set(groups.flatMap((group) => group.ships.flatMap(collectShipKeys)))
							)
						}}
						className="rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						Expand all
					</button>
					<button
						type="button"
						onClick={() => {
							setExpandedLocations(new Set())
							setExpandedShips(new Set())
						}}
						className="rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						Collapse all
					</button>
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
								className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
							>
								{isExpanded ? (
									<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<span className="font-medium text-sm flex-1 truncate">{group.locationName}</span>
								<span className="text-xs text-muted-foreground">
									{group.ships.length} ship{group.ships.length !== 1 ? 's' : ''}
								</span>
								{group.estimatedValue > 0 && (
									<span className="text-xs font-medium text-amber-400">
										{formatIsk(group.estimatedValue)}
									</span>
								)}
							</button>

							{isExpanded && (
								<div className="ml-6 space-y-2 py-1">
									{group.ships.map((ship, i) => {
										const shipKey = ship.itemId || `${ship.shipTypeId}-${i}`
										return (
											<ShipCard
												key={shipKey}
												ship={ship}
												isExpanded={expandedShips.has(shipKey)}
												onToggleShip={toggleShip}
												expandedShips={expandedShips}
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
