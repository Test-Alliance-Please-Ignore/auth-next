/**
 * EVE-Style Circular Fitting Panel
 *
 * Renders a 398×398 panel replicating the in-game fitting window.
 * Layers: base ring → slot overlays (by count) → ship render → module icons.
 */

import type { FittingItem } from '../types'

// EVE image helpers
const getTypeIconUrl = (typeId: string, size: 32 | 64 = 32) =>
	`https://images.evetech.net/types/${typeId}/icon?size=${size}`

const getShipRenderUrl = (typeId: string, size: 64 | 128 | 256 | 512 = 256) =>
	`https://images.evetech.net/types/${typeId}/render?size=${size}`

// Panel constants (matches the 398×398 overlay PNGs)
const PANEL_SIZE = 398
const SHIP_SIZE = 256
const SHIP_LEFT = 72
const SHIP_TOP = 71
const SLOT_SIZE = 32

// Exact slot pixel positions around the ring
const HIGH_POSITIONS = [
	{ left: 73, top: 60 },
	{ left: 102, top: 42 },
	{ left: 134, top: 27 },
	{ left: 169, top: 21 },
	{ left: 203, top: 22 },
	{ left: 238, top: 30 },
	{ left: 270, top: 45 },
	{ left: 295, top: 64 },
]

const MID_POSITIONS = [
	{ left: 26, top: 140 },
	{ left: 24, top: 176 },
	{ left: 23, top: 212 },
	{ left: 30, top: 245 },
	{ left: 46, top: 278 },
	{ left: 69, top: 304 },
	{ left: 100, top: 328 },
	{ left: 133, top: 342 },
]

const LOW_POSITIONS = [
	{ left: 344, top: 143 },
	{ left: 350, top: 178 },
	{ left: 349, top: 213 },
	{ left: 340, top: 246 },
	{ left: 323, top: 277 },
	{ left: 300, top: 304 },
	{ left: 268, top: 324 },
	{ left: 234, top: 338 },
]

const RIG_POSITIONS = [
	{ left: 148, top: 259 },
	{ left: 185, top: 267 },
	{ left: 221, top: 259 },
]

const SUB_POSITIONS = [
	{ left: 117, top: 131 },
	{ left: 147, top: 108 },
	{ left: 184, top: 98 },
	{ left: 221, top: 107 },
]

/** Group fitting items by slot type */
function groupBySlot(items: FittingItem[]) {
	const high: FittingItem[] = []
	const mid: FittingItem[] = []
	const low: FittingItem[] = []
	const rig: FittingItem[] = []
	const sub: FittingItem[] = []

	for (const item of items) {
		switch (item.flagName) {
			case 'High Slot':
				high.push(item)
				break
			case 'Mid Slot':
				mid.push(item)
				break
			case 'Low Slot':
				low.push(item)
				break
			case 'Rig Slot':
				rig.push(item)
				break
			case 'Subsystem Slot':
				sub.push(item)
				break
		}
	}

	return { high, mid, low, rig, sub }
}

interface FittingPanelProps {
	fittingItems: FittingItem[]
	shipTypeId: string
	shipName: string
}

export function FittingPanel({ fittingItems, shipTypeId, shipName }: FittingPanelProps) {
	const slots = groupBySlot(fittingItems)

	const highCount = Math.min(slots.high.length, 8)
	const midCount = Math.min(slots.mid.length, 8)
	const lowCount = Math.min(slots.low.length, 8)
	const rigCount = Math.min(slots.rig.length, 3)
	const subCount = Math.min(slots.sub.length, 5)

	return (
		<div className="flex justify-center">
			<div className="relative" style={{ width: PANEL_SIZE, height: PANEL_SIZE }}>
				{/* Ship render in center — BEHIND the ring so the ring masks it */}
				<img
					src={getShipRenderUrl(shipTypeId)}
					alt={shipName}
					title={shipName}
					className="absolute rounded"
					style={{
						width: SHIP_SIZE,
						height: SHIP_SIZE,
						left: SHIP_LEFT,
						top: SHIP_TOP,
						zIndex: 1,
					}}
				/>

				{/* Base ring — sits on top of ship to clip it */}
				<img
					src="/img/panel/tyrannis.png"
					alt=""
					className="absolute inset-0 rounded"
					style={{ width: PANEL_SIZE, height: PANEL_SIZE, zIndex: 2 }}
				/>

				{/* Slot overlays — selected by count */}
				<img
					src={`/img/panel/${highCount}h.png`}
					alt=""
					className="absolute inset-0 rounded"
					style={{ width: PANEL_SIZE, height: PANEL_SIZE, zIndex: 3 }}
				/>
				<img
					src={`/img/panel/${midCount}m.png`}
					alt=""
					className="absolute inset-0 rounded"
					style={{ width: PANEL_SIZE, height: PANEL_SIZE, zIndex: 3 }}
				/>
				<img
					src={`/img/panel/${lowCount}l.png`}
					alt=""
					className="absolute inset-0 rounded"
					style={{ width: PANEL_SIZE, height: PANEL_SIZE, zIndex: 3 }}
				/>
				<img
					src={`/img/panel/${rigCount}r.png`}
					alt=""
					className="absolute inset-0 rounded"
					style={{ width: PANEL_SIZE, height: PANEL_SIZE, zIndex: 3 }}
				/>
				{subCount > 0 && (
					<img
						src={`/img/panel/${subCount}s.png`}
						alt=""
						className="absolute inset-0 rounded"
						style={{ width: PANEL_SIZE, height: PANEL_SIZE, zIndex: 3 }}
					/>
				)}

				{/* Module icons */}
				{slots.high.map((item, i) =>
					HIGH_POSITIONS[i] ? (
						<SlotIcon key={`h-${i}`} item={item} position={HIGH_POSITIONS[i]} />
					) : null
				)}
				{slots.mid.map((item, i) =>
					MID_POSITIONS[i] ? (
						<SlotIcon key={`m-${i}`} item={item} position={MID_POSITIONS[i]} />
					) : null
				)}
				{slots.low.map((item, i) =>
					LOW_POSITIONS[i] ? (
						<SlotIcon key={`l-${i}`} item={item} position={LOW_POSITIONS[i]} />
					) : null
				)}
				{slots.rig.map((item, i) =>
					RIG_POSITIONS[i] ? (
						<SlotIcon key={`r-${i}`} item={item} position={RIG_POSITIONS[i]} />
					) : null
				)}
				{slots.sub.map((item, i) =>
					SUB_POSITIONS[i] ? (
						<SlotIcon key={`s-${i}`} item={item} position={SUB_POSITIONS[i]} />
					) : null
				)}
			</div>
		</div>
	)
}

function SlotIcon({
	item,
	position,
}: {
	item: FittingItem
	position: { left: number; top: number }
}) {
	return (
		<img
			src={getTypeIconUrl(item.typeId)}
			alt={item.typeName}
			title={item.typeName}
			className="absolute rounded"
			style={{
				width: SLOT_SIZE,
				height: SLOT_SIZE,
				left: position.left,
				top: position.top,
				zIndex: 4,
			}}
		/>
	)
}
