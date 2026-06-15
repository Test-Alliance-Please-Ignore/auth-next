/**
 * SRP fitting panel wrapper.
 *
 * The shared fitting package owns the ship/pod geometry and slot rendering.
 * This wrapper keeps SRP-specific item filtering and pod detection local.
 */

import { typeIconUrl, typeRenderUrl } from '@/lib/eve-images'
import { FittingPanel as SharedFittingPanel } from '@repo/eve-fitting/fitting-panel'
import type { FittingDisplayItem } from '@repo/eve-fitting/flags'

import { isPodLoss } from '../utils/fitting'

import type {
	SRPFittingItem,
	SRPShipSlotCapacities,
	SRPSlotHighlightMap,
} from '../utils/fitting'

interface SRPFittingPanelProps {
	shipTypeId: string
	shipTypeName?: string
	items: SRPFittingItem[]
	slotHighlights?: SRPSlotHighlightMap
	slotCapacities?: SRPShipSlotCapacities
}

function toDisplayItems(items: SRPFittingItem[], isPod: boolean): FittingDisplayItem[] {
	return items
		.filter((item) => {
			if (isPod) {
				return item.slotType === 'implant'
			}
			return item.slotType !== 'implant' && !item.isConsumable
		})
		.map((item) => ({
			typeId: item.typeId,
			typeName: item.typeName,
			quantity: Math.max(1, item.quantity),
			slotType: item.slotType,
			slotIndex: item.slotIndex,
		}))
}

export function SRPFittingPanel({
	shipTypeId,
	shipTypeName,
	items,
	slotHighlights = {},
	slotCapacities = {},
}: SRPFittingPanelProps) {
	const isPod = isPodLoss(shipTypeId)

	return (
		<SharedFittingPanel
			shipTypeId={shipTypeId}
			shipTypeName={shipTypeName}
			items={toDisplayItems(items, isPod)}
			slotHighlights={slotHighlights}
			slotCapacities={slotCapacities}
			mode={isPod ? 'pod' : 'ship'}
			getIconUrl={typeIconUrl}
			getRenderUrl={typeRenderUrl}
		/>
	)
}
