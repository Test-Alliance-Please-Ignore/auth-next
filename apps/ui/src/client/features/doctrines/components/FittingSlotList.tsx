/**
 * Fitting Slot List
 *
 * Full-width item list grouped by slot type with EVE item icons.
 */

import type { FittingItem } from '../types'

const getTypeIconUrl = (typeId: string) =>
	`https://images.evetech.net/types/${typeId}/icon?size=32`

/** Ordered slot sections for UI display. Canonical source: SLOT_FLAGS in @repo/doctrines */
const SLOT_SECTIONS = [
	{ flagName: 'High Slot', label: 'High Slots' },
	{ flagName: 'Mid Slot', label: 'Mid Slots' },
	{ flagName: 'Low Slot', label: 'Low Slots' },
	{ flagName: 'Rig Slot', label: 'Rig Slots' },
	{ flagName: 'Subsystem Slot', label: 'Subsystems' },
	{ flagName: 'Service Slot', label: 'Service Slots' },
	{ flagName: 'Drone Bay', label: 'Drone Bay' },
	{ flagName: 'Fighter Bay', label: 'Fighter Bay' },
	{ flagName: 'Implant', label: 'Implants' },
	{ flagName: 'Cargo', label: 'Cargo' },
] as const

interface FittingSlotListProps {
	fittingItems: FittingItem[]
}

export function FittingSlotList({ fittingItems }: FittingSlotListProps) {
	// Group items by flagName
	const grouped = new Map<string, FittingItem[]>()
	for (const item of fittingItems) {
		const list = grouped.get(item.flagName)
		if (list) {
			list.push(item)
		} else {
			grouped.set(item.flagName, [item])
		}
	}

	return (
		<div className="space-y-0 rounded-md border overflow-hidden">
			{SLOT_SECTIONS.map((section) => {
				const items = grouped.get(section.flagName)
				if (!items || items.length === 0) return null

				return (
					<div key={section.flagName}>
						{/* Section header */}
						<div className="bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b">
							{section.label}
						</div>
						{/* Items */}
						{items.map((item, i) => (
							<div
								key={item.id || `${section.flagName}-${i}`}
								className="flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 hover:bg-muted/30"
							>
								<img
									src={getTypeIconUrl(item.typeId)}
									alt=""
									className="h-6 w-6 rounded flex-shrink-0"
									onError={(e) => {
										; (e.target as HTMLImageElement).style.display = 'none'
									}}
								/>
								<span className="text-sm">
									{item.typeName}
									{parseInt(item.quantity) > 1 && (
										<span className="text-primary ml-1.5">
											x{parseInt(item.quantity).toLocaleString()}
										</span>
									)}
								</span>
							</div>
						))}
					</div>
				)
			})}
		</div>
	)
}
