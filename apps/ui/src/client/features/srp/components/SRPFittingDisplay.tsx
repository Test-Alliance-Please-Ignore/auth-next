import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { typeIconUrl } from '@/lib/eve-images'

import { SRPFittingPanel } from './SRPFittingPanel'
import { SRPFittingSlotList } from './SRPFittingSlotList'

import type {
	SRPCargoItem,
	SRPFittingItem,
	SRPShipSlotCapacities,
	SRPSlotHighlightMap,
} from '../utils/fitting'
import type { ReactNode } from 'react'

interface SRPFittingDisplayProps {
	shipTypeId: string
	shipTypeName?: string
	fittingItems: SRPFittingItem[]
	cargoItems?: SRPCargoItem[]
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
		</div>
	)
}
