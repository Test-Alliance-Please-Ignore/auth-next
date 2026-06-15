/**
 * Doctrine fitting panel wrapper.
 *
 * The shared fitting package owns the geometry; this adapter maps doctrine
 * fitting items into the common slot model.
 */

import { typeIconUrl, typeRenderUrl } from '@/lib/eve-images'
import { FittingPanel as SharedFittingPanel } from '@repo/eve-fitting/fitting-panel'
import type { FittingDisplayItem, FittingShipSlotType } from '@repo/eve-fitting/flags'

import type { FittingItem } from '../types'

interface FittingPanelProps {
	fittingItems: FittingItem[]
	shipTypeId: string
	shipName: string
}

const FLAG_TO_SLOT_TYPE: Record<string, FittingShipSlotType> = {
	'High Slot': 'high',
	'Mid Slot': 'mid',
	'Low Slot': 'low',
	'Rig Slot': 'rig',
	'Subsystem Slot': 'sub',
}

function toDisplayItems(fittingItems: FittingItem[]): FittingDisplayItem[] {
	const groups = new Map<string, FittingItem[]>()
	for (const item of fittingItems) {
		if (!(item.flagName in FLAG_TO_SLOT_TYPE)) {
			continue
		}

		const items = groups.get(item.flagName)
		if (items) {
			items.push(item)
		} else {
			groups.set(item.flagName, [item])
		}
	}

	return Array.from(groups.entries()).flatMap(([flagName, items]) => {
		const slotType = FLAG_TO_SLOT_TYPE[flagName]
		return items.map((item, slotIndex) => ({
			typeId: item.typeId,
			typeName: item.typeName,
			quantity: Math.max(1, Number.parseInt(item.quantity, 10) || 1),
			slotType,
			slotIndex,
		}))
	})
}

export function FittingPanel({ fittingItems, shipTypeId, shipName }: FittingPanelProps) {
	return (
		<SharedFittingPanel
			shipTypeId={shipTypeId}
			shipTypeName={shipName}
			items={toDisplayItems(fittingItems)}
			getIconUrl={typeIconUrl}
			getRenderUrl={typeRenderUrl}
		/>
	)
}
