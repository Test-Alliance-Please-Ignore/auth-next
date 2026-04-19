import { typeIconUrl } from '@/lib/eve-images'

import { formatISK } from '../utils'
import { isPodLoss } from '../utils/fitting'

import type { SlotType, SRPFittingItem } from '../utils/fitting'

interface SRPFittingSlotListProps {
	shipTypeId: string
	items: SRPFittingItem[]
}

const SHIP_SECTION_ORDER: SlotType[] = ['high', 'mid', 'low', 'rig', 'sub']
const SHIP_SECTION_LABELS: Record<string, string> = {
	high: 'High Slots',
	mid: 'Mid Slots',
	low: 'Low Slots',
	rig: 'Rig Slots',
	sub: 'Subsystems',
}

export function SRPFittingSlotList({ shipTypeId, items }: SRPFittingSlotListProps) {
	const isPod = isPodLoss(shipTypeId)

	if (isPod) {
		const top = items
			.filter((i) => i.slotType === 'implant' && i.slotIndex < 5)
			.sort((a, b) => a.slotIndex - b.slotIndex)
		const bottom = items
			.filter((i) => i.slotType === 'implant' && i.slotIndex >= 5)
			.sort((a, b) => a.slotIndex - b.slotIndex)

		return (
			<div className="space-y-3">
				{top.length > 0 && <SlotSection label="Implants 1–5" items={top} />}
				{bottom.length > 0 && <SlotSection label="Implants 6–10" items={bottom} />}
				{top.length === 0 && bottom.length === 0 && (
					<p className="text-sm text-muted-foreground">No implants recorded</p>
				)}
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

	const sections = SHIP_SECTION_ORDER.filter((t) => groups[t]?.length)

	return (
		<div className="space-y-3">
			{sections.length === 0 && (
				<p className="text-sm text-muted-foreground">No fitting data available</p>
			)}
			{sections.map((type) => (
				<SlotSection key={type} label={SHIP_SECTION_LABELS[type] ?? type} items={groups[type]} />
			))}
		</div>
	)
}

function SlotSection({ label, items }: { label: string; items: SRPFittingItem[] }) {
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
				<span className="text-xs text-muted-foreground">{formatISK(String(sectionTotal))}</span>
			</div>
			<div className="space-y-1 rounded-md border border-border/40 bg-muted/10 p-1">
				{items.map((item, i) => (
					<ItemRow key={`${item.typeId}-${item.slotIndex}-${i}`} item={item} />
				))}
			</div>
		</div>
	)
}

function ItemRow({ item }: { item: SRPFittingItem }) {
	return (
		<div className={`flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/20 ${item.isConsumable ? 'opacity-50' : ''}`}>
			<img
				src={typeIconUrl(item.typeId, 32)}
				alt={item.typeName}
				className="h-8 w-8 flex-shrink-0 rounded border border-border/40 object-contain"
				loading="lazy"
			/>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium leading-tight">{item.typeName}</p>
				{item.quantity > 1 && <p className="text-xs text-muted-foreground">×{item.quantity}</p>}
				{item.isConsumable && (
					<p className="text-xs text-muted-foreground/60">consumable — not included</p>
				)}
			</div>
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
		</div>
	)
}
