import type { ReactNode } from 'react'

import type { FittingDisplayItem, FittingShipSlotType } from './flags'

interface FittingSlotTableProps {
	items: FittingDisplayItem[]
	getIconUrl?: (typeId: string | number, size?: 32 | 64) => string
	slotTypes?: FittingShipSlotType[]
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

export function FittingSlotTable({
	items,
	getIconUrl,
	slotTypes = DEFAULT_SLOT_TYPES,
	emptyState = 'No high, mid, or low slot items detected.',
}: FittingSlotTableProps) {
	const sections = slotTypes
		.map((slotType) => {
			const sectionItems = items
				.filter((item) => item.slotType === slotType)
				.slice()
				.sort((left, right) => {
					if (left.slotIndex !== right.slotIndex) {
						return left.slotIndex - right.slotIndex
					}

					return left.typeName.localeCompare(right.typeName)
				})

			return { slotType, sectionItems }
		})
		.filter((section) => section.sectionItems.length > 0)

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
					<div className="space-y-1 rounded-md border border-border/40 bg-muted/10 p-1">
						{section.sectionItems.map((item) => (
							<div
								key={`${item.slotType}:${item.slotIndex}:${item.typeId}`}
								className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/20"
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
										<p className="text-xs text-muted-foreground">x{item.quantity.toLocaleString()}</p>
									) : null}
								</div>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	)
}
