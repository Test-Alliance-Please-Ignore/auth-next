import { typeIconUrl } from '@/lib/eve-images'

import { formatISK } from '../utils'
import { isPodLoss } from '../utils/fitting'

import type {
	SlotType,
	SRPFittingItem,
	SRPShipSlotCapacities,
	SRPShipSlotType,
	SRPSlotCapacityType,
	SRPSlotHighlightMap,
} from '../utils/fitting'

interface SRPFittingSlotListProps {
	shipTypeId: string
	items: SRPFittingItem[]
	slotHighlights?: SRPSlotHighlightMap
	slotCapacities?: SRPShipSlotCapacities
	showPricing?: boolean
}

const SHIP_SECTION_ORDER: SRPShipSlotType[] = ['high', 'mid', 'low', 'rig', 'sub']
const SHIP_SECTION_LABELS: Record<SRPShipSlotType, string> = {
	high: 'High Slots',
	mid: 'Mid Slots',
	low: 'Low Slots',
	rig: 'Rig Slots',
	sub: 'Subsystems',
}

export function SRPFittingSlotList({
	shipTypeId,
	items,
	slotHighlights = {},
	slotCapacities = {},
	showPricing = true,
}: SRPFittingSlotListProps) {
	const isPod = isPodLoss(shipTypeId)

	if (isPod) {
		const top = items
			.filter((i) => i.slotType === 'implant' && i.slotIndex < 5)
			.sort((a, b) => a.slotIndex - b.slotIndex)
		const bottom = items
			.filter((i) => i.slotType === 'implant' && i.slotIndex >= 5)
			.sort((a, b) => a.slotIndex - b.slotIndex)
		const implantCapacity = Math.max(0, Math.min(10, Math.trunc(slotCapacities.implant ?? 10)))
		const topCapacity = Math.min(5, implantCapacity)
		const bottomCapacity = Math.min(5, Math.max(0, implantCapacity - topCapacity))

		return (
			<div className="space-y-3">
				<SlotSection
					label="Implants 1–5"
					items={top}
					slotHighlights={slotHighlights}
					slotType="implant"
					slotCapacity={topCapacity}
					slotOffset={0}
					showPricing={showPricing}
				/>
				<SlotSection
					label="Implants 6–10"
					items={bottom}
					slotHighlights={slotHighlights}
					slotType="implant"
					slotCapacity={bottomCapacity}
					slotOffset={5}
					showPricing={showPricing}
				/>
			</div>
		)
	}

	const groups: Record<string, SRPFittingItem[]> = {}
	for (const item of items) {
		if (!groups[item.slotType]) groups[item.slotType] = []
		groups[item.slotType].push(item)
	}
	for (const key of Object.keys(groups)) {
		groups[key].sort((a, b) => a.slotIndex - b.slotIndex)
	}

	const sections = SHIP_SECTION_ORDER.filter((t) => (slotCapacities[t] ?? 0) > 0 || groups[t]?.length)

	return (
		<div className="space-y-3">
			{sections.length === 0 && (
				<p className="text-sm text-muted-foreground">No fitting data available</p>
			)}
			{sections.map((type) => (
				<SlotSection
					key={type}
					label={SHIP_SECTION_LABELS[type] ?? type}
					items={groups[type]}
					slotHighlights={slotHighlights}
					slotType={type}
					slotCapacity={slotCapacities[type]}
					slotOffset={0}
					showPricing={showPricing}
				/>
			))}
		</div>
	)
}

function SlotSection({
	label,
	items,
	slotHighlights = {},
	slotType,
	slotCapacity,
	slotOffset = 0,
	showPricing = true,
}: {
	label: string
	items: SRPFittingItem[]
	slotHighlights?: SRPSlotHighlightMap
	slotType?: SRPSlotCapacityType
	slotCapacity?: number
	slotOffset?: number
	showPricing?: boolean
}) {
	// Section total excludes consumables (ammo/charges not valued)
	const sectionTotal = items.reduce(
		(sum, i) => sum + (i.isConsumable ? 0 : parseFloat(i.lineTotal || '0')),
		0
	)

	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					{label}
				</h4>
				{showPricing && (
					<span className="text-xs text-muted-foreground">
						{formatISK(String(sectionTotal))}
					</span>
				)}
			</div>
			<div className="space-y-1 rounded-md border border-border/40 bg-muted/10 p-1">
				{items.map((item, i) => (
					<ItemRow
						key={`${item.typeId}-${item.slotIndex}-${i}`}
						item={item}
						severity={slotHighlights[`${item.slotType}:${item.slotIndex}`]}
						showPricing={showPricing}
					/>
				))}
				{slotType && typeof slotCapacity === 'number' && slotCapacity > 0 && (
					<>
						{Array.from({ length: slotCapacity }, (_, slotIndex) => slotIndex)
							.filter((slotIndex) =>
								!items.some(
									(item) =>
										item.slotType === slotType &&
										item.slotIndex === slotIndex + slotOffset &&
										!item.isConsumable
								)
							)
							.map((slotIndex) => {
								const absoluteSlotIndex = slotIndex + slotOffset
								const severity = slotHighlights[`${slotType}:${absoluteSlotIndex}`]
								return (
									<EmptyItemRow
										key={`empty-${slotType}-${absoluteSlotIndex}`}
										slotType={slotType}
										slotIndex={absoluteSlotIndex}
										severity={severity}
									/>
								)
							})}
					</>
				)}
			</div>
		</div>
	)
}

function ItemRow({
	item,
	severity,
	showPricing = true,
}: {
	item: SRPFittingItem
	severity?: 'destructive' | 'warning' | 'secondary'
	showPricing?: boolean
}) {
	const severityClass =
		severity === 'destructive'
			? 'bg-destructive/12'
			: severity === 'warning'
				? 'bg-warning/12'
				: severity === 'secondary'
					? 'bg-secondary/12'
					: 'hover:bg-muted/20'
	return (
		<div className={`flex items-center gap-2 rounded px-1 py-0.5 ${severityClass} ${item.isConsumable ? 'opacity-50' : ''}`}>
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
						<span className="ml-1.5 text-primary">x{item.quantity.toLocaleString()}</span>
					)}
				</p>
				{item.isConsumable && (
					<p className="text-xs text-muted-foreground/60">consumable — not included</p>
				)}
			</div>
			{showPricing && (
				<div className="text-right">
					<p className={`font-mono text-xs tabular-nums ${item.isConsumable ? 'line-through text-muted-foreground/50' : ''}`}>
						{formatISK(item.lineTotal)}
					</p>
					{item.quantity > 1 && (
						<p className="font-mono text-xs text-muted-foreground tabular-nums">
							{formatISK(item.unitPrice)} ea
						</p>
					)}
				</div>
			)}
		</div>
	)
}

function EmptyItemRow({
	slotType,
	slotIndex,
	severity,
}: {
	slotType: SlotType
	slotIndex: number
	severity?: 'destructive' | 'warning' | 'secondary'
}) {
	const severityClass =
		severity === 'destructive'
			? 'bg-destructive/12'
			: severity === 'warning'
				? 'bg-warning/12'
				: severity === 'secondary'
					? 'bg-secondary/12'
					: 'bg-muted/10'
	return (
		<div className={`flex items-center gap-2 rounded px-1 py-0.5 ${severityClass}`}>
			<div className="h-8 w-8 flex-shrink-0 rounded border border-border/40 bg-muted/20" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium leading-tight">Empty {slotType} slot</p>
				<p className="text-xs text-muted-foreground">Slot {slotIndex + 1}</p>
			</div>
			<div className="text-right">
				<p className="font-mono text-xs tabular-nums text-muted-foreground">—</p>
			</div>
		</div>
	)
}
