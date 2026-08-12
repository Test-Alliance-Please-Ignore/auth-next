import type { ReactNode } from 'react'
import type { FittingDisplayItem, FittingShipSlotType, FittingSlotCapacities } from './flags'

interface FittingSlotTableProps {
	items: FittingDisplayItem[]
	getIconUrl?: (typeId: string | number, size?: 32 | 64) => string
	slotTypes?: FittingShipSlotType[]
	slotCapacities?: FittingSlotCapacities
	emptyState?: ReactNode
}

const SLOT_TYPE_LABELS: Record<FittingShipSlotType, string> = {
	high: 'High Slots',
	mid: 'Mid Slots',
	low: 'Low Slots',
	rig: 'Rig Slots',
	sub: 'Subsystems',
}

const DEFAULT_SLOT_TYPES: FittingShipSlotType[] = ['high', 'mid', 'low']

interface GroupedSlotItems {
	slotType: FittingShipSlotType
	slotIndex: number
	items: FittingDisplayItem[]
}

function groupItemsBySlot(
	items: FittingDisplayItem[],
	slotTypes: FittingShipSlotType[],
	slotCapacities: FittingSlotCapacities
): Array<{ slotType: FittingShipSlotType; groupedSlots: GroupedSlotItems[] }> {
	return slotTypes
		.map((slotType) => {
			const slotGroups = new Map<number, FittingDisplayItem[]>()
			for (const item of items) {
				if (item.slotType !== slotType) continue
				const group = slotGroups.get(item.slotIndex) ?? []
				group.push(item)
				slotGroups.set(item.slotIndex, group)
			}
			const capacity = Math.max(0, Math.trunc(slotCapacities[slotType] ?? 0))
			for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
				if (!slotGroups.has(slotIndex)) slotGroups.set(slotIndex, [])
			}

			const groupedSlots = [...slotGroups.entries()]
				.sort((left, right) => left[0] - right[0])
				.map(([slotIndex, slotItems]) => ({
					slotType,
					slotIndex,
					items: slotItems.slice().sort((left, right) => {
						if (left.isConsumable !== right.isConsumable) {
							return left.isConsumable ? 1 : -1
						}
						if (left.typeName !== right.typeName) {
							return left.typeName.localeCompare(right.typeName)
						}
						return left.typeId.localeCompare(right.typeId)
					}),
				}))

			return { slotType, groupedSlots }
		})
		.filter((section) => section.groupedSlots.length > 0)
}

export function FittingSlotTable({
	items,
	getIconUrl,
	slotTypes = DEFAULT_SLOT_TYPES,
	slotCapacities = {},
	emptyState = 'No fitting items detected.',
}: FittingSlotTableProps) {
	const sections = groupItemsBySlot(items, slotTypes, slotCapacities)

	if (sections.length === 0) {
		return <p className="text-sm text-muted-foreground">{emptyState}</p>
	}

	return (
		<div className="space-y-3">
			{sections.map((section) => (
				<div key={section.slotType}>
					<div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						{SLOT_TYPE_LABELS[section.slotType] ?? section.slotType}
					</div>
					<div className="space-y-0.5 rounded-md border border-border/40 bg-muted/10 p-1">
						{section.groupedSlots.map((slotGroup) => (
							<div key={`${slotGroup.slotType}:${slotGroup.slotIndex}`} className="space-y-0.5">
								{slotGroup.items.length === 0 ? (
									<div className="flex items-center gap-2 rounded px-1 py-1 text-sm text-muted-foreground">
										<span className="h-5 w-5 shrink-0 rounded border border-dashed border-border/60" />
										<span>Empty</span>
									</div>
								) : null}
								{slotGroup.items.map((item, itemIndex) => (
									<div
										key={`${item.slotType}:${item.slotIndex}:${item.typeId}:${itemIndex}`}
										className={`flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/20 ${
											item.isConsumable ? 'opacity-60' : ''
										} ${item.isConsumable && itemIndex > 0 ? 'ml-6 border-l border-border/50 pl-3' : ''}`}
									>
										{getIconUrl ? (
											<img
												src={getIconUrl(item.typeId, 32)}
												alt=""
												className="h-6 w-6 shrink-0 rounded border border-border/40 object-contain"
												loading="lazy"
											/>
										) : null}
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium leading-tight">{item.typeName}</p>
											{item.quantity > 1 ? (
												<p className="text-xs text-muted-foreground">
													x{item.quantity.toLocaleString()}
												</p>
											) : null}
											{item.isConsumable && (
												<p className="text-xs text-muted-foreground/60">loaded item</p>
											)}
										</div>
									</div>
								))}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	)
}
