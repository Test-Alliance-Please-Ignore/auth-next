import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { typeIconUrl } from '@/lib/eve-images'

import { SRPFittingPanel } from './SRPFittingPanel'
import { SRPFittingSlotList } from './SRPFittingSlotList'

import type { ReactNode } from 'react'
import type {
	SRPCargoItem,
	SRPFittingItem,
	SRPShipMaintenanceBayContent,
	SRPShipMaintenanceBayShip,
	SRPShipSlotCapacities,
	SRPSlotHighlightMap,
} from '../utils/fitting'

interface SRPFittingDisplayProps {
	shipTypeId: string
	shipTypeName?: string
	fittingItems: SRPFittingItem[]
	cargoItems?: SRPCargoItem[]
	shipMaintenanceBayShips?: SRPShipMaintenanceBayShip[]
	slotHighlights?: SRPSlotHighlightMap
	slotCapacities?: SRPShipSlotCapacities
	showPricing?: boolean
	panelLoading?: boolean
	middleContent?: ReactNode
}

export function SRPFittingDisplay({
	shipTypeId,
	shipTypeName,
	fittingItems,
	cargoItems,
	shipMaintenanceBayShips,
	slotHighlights,
	slotCapacities,
	showPricing = true,
	panelLoading = false,
	middleContent,
}: SRPFittingDisplayProps) {
	return (
		<div className="flex flex-col gap-4">
			{panelLoading ? (
				<div className="flex justify-center">
					<Skeleton className="h-[398px] w-[398px] max-w-full rounded-md" />
				</div>
			) : (
				<SRPFittingPanel
					shipTypeId={shipTypeId}
					shipTypeName={shipTypeName}
					items={fittingItems}
					slotHighlights={slotHighlights}
					slotCapacities={slotCapacities}
				/>
			)}

			{middleContent}

			<Card className="p-4">
				<h4 className="mb-3 font-semibold text-sm">Fitting</h4>
				<SRPFittingSlotList
					shipTypeId={shipTypeId}
					items={fittingItems}
					slotHighlights={slotHighlights}
					slotCapacities={slotCapacities}
					showPricing={showPricing}
				/>
			</Card>

			{cargoItems && (
				<Card className="p-4">
					<h4 className="mb-3 font-semibold text-sm">Cargo</h4>
					{cargoItems.length === 0 ? (
						<p className="text-sm text-muted-foreground">No cargo recorded on lossmail.</p>
					) : (
						<div className="space-y-1 rounded-md border border-border/40 bg-muted/10 p-1">
							{cargoItems.map((item) => (
								<div
									key={item.typeId}
									className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/20"
								>
									<img
										src={typeIconUrl(item.typeId, 32)}
										alt={item.typeName}
										className="h-8 w-8 flex-shrink-0 rounded border border-border/40 object-contain"
										loading="lazy"
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium leading-tight">
											{item.typeName}
											{item.quantity > 1 && (
												<span className="ml-1.5 text-primary">
													x{item.quantity.toLocaleString()}
												</span>
											)}
										</p>
									</div>
								</div>
							))}
						</div>
					)}
				</Card>
			)}

			{shipMaintenanceBayShips && shipMaintenanceBayShips.length > 0 && (
				<ShipMaintenanceBayCard ships={shipMaintenanceBayShips} />
			)}
		</div>
	)
}

function ShipMaintenanceBayCard({ ships }: { ships: SRPShipMaintenanceBayShip[] }) {
	const [expandedShips, setExpandedShips] = useState<Set<string>>(new Set())

	const toggleShip = (key: string) => {
		setExpandedShips((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	return (
		<Card className="p-4">
			<h4 className="mb-3 font-semibold text-sm">Ship Maintenance Bay</h4>
			<div className="space-y-1 rounded-md border border-border/40 bg-muted/10 p-1">
				{ships.map((ship, index) => {
					const key = `${ship.typeId}-${index}`
					const isExpanded = expandedShips.has(key)

					return (
						<div key={key} className="rounded border border-border/30">
							<button
								type="button"
								onClick={() => toggleShip(key)}
								aria-expanded={isExpanded}
								className="flex w-full cursor-pointer items-center gap-2 rounded px-1 py-1 text-left hover:bg-muted/20"
							>
								{isExpanded ? (
									<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
								) : (
									<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
								)}
								<img
									src={typeIconUrl(ship.typeId, 32)}
									alt={ship.typeName}
									className="h-8 w-8 shrink-0 rounded border border-border/40 object-contain"
									loading="lazy"
								/>
								<span className="min-w-0 flex-1 truncate text-sm font-medium">
									{ship.typeName}
									{ship.quantity > 1 && (
										<span className="ml-1.5 text-primary">x{ship.quantity.toLocaleString()}</span>
									)}
								</span>
								<span className="text-xs text-muted-foreground">
									{ship.contents.length} item{ship.contents.length === 1 ? '' : 's'}
								</span>
							</button>
							{isExpanded && <MaintenanceBayContents contents={ship.contents} />}
						</div>
					)
				})}
			</div>
		</Card>
	)
}

function MaintenanceBayContents({
	contents,
	depth = 0,
}: {
	contents: SRPShipMaintenanceBayContent[]
	depth?: number
}) {
	return (
		<div className="border-t border-border/30 px-3 py-2">
			{contents.length === 0 ? (
				<p className="text-xs text-muted-foreground">No contents recorded.</p>
			) : (
				<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
					{contents.map((item, index) => (
						<div key={`${item.typeId}-${index}`} className="contents">
							<div
								className="flex min-w-0 items-center gap-2"
								style={{ paddingLeft: `${depth * 1.25}rem` }}
							>
								<img
									src={typeIconUrl(item.typeId, 32)}
									alt={item.typeName}
									className="h-6 w-6 shrink-0 rounded border border-border/30 object-contain"
									loading="lazy"
								/>
								<span className="truncate">{item.typeName}</span>
							</div>
							<span className="text-right text-muted-foreground">
								x{item.quantity.toLocaleString()}
							</span>
							{item.items?.length ? (
								<div className="col-span-2">
									<MaintenanceBayContents contents={item.items} depth={depth + 1} />
								</div>
							) : null}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
