/**
 * EVE-Style Circular Fitting Panel (SVG)
 *
 * Renders a 398×398 panel replicating the in-game fitting window.
 * Ring and slot markers are pure inline SVG; ship renders and module icons
 * are images from images.evetech.net.
 *
 * Slot positions are computed on circular arcs (not hardcoded pixel values)
 * to ensure perfectly consistent alignment and rotation.
 */

import type { FittingItem } from '../types'

// ── EVE image helpers ───────────────────────────────────────────
const eveIcon = (typeId: string, size: 32 | 64 = 32) =>
	`https://images.evetech.net/types/${typeId}/icon?size=${size}`

const eveRender = (typeId: string, size: 64 | 128 | 256 | 512 = 512) =>
	`https://images.evetech.net/types/${typeId}/render?size=${size}`

// ── Core geometry ───────────────────────────────────────────────
const P = 398 // panel size
const CX = 199 // center x
const CY = 199 // center y
const OUTER_R = 196 // outer ring radius
const INNER_R = 130 // inner ring radius

// 3 divider angles between High/Low/Mid sections (midpoints of the gaps)
const DIVIDER_ANGLES = [-30, 90, 211.5]

// Outer edge: 3 V-notches pointing inward
const OUTER_NOTCH_TIP_R = 184 // tip depth (12px in from outer edge)
const OUTER_NOTCH_HALF = 7 // half angular span

// Inner edge: 3 outward V-notches (matching dividers) + 2 inward V-notches (flanking rigs)
const INNER_OUTWARD_TIP_R = 148 // outward tips (18px into ring body)
const INNER_OUTWARD_HALF = 10 // half angular span
const INNER_INWARD_TIP_R = 116 // inward tips (14px toward center)
const INNER_INWARD_HALF = 9 // half angular span
const INNER_INWARD_ANGLES = [50, 130] // one on each side of rig section
const BEVEL = 5 // bevel stroke width
const SS = 32 // slot icon size
const SHIP_SZ = 300
const SHIP_X = 49
const SHIP_Y = 49

// ── Colors ──────────────────────────────────────────────────────
const RING_FILL = '#1a1a1e'
const SLOT_STROKE = 'rgba(200,200,200,0.6)'
const ICON_FILL = 'rgba(180,180,180,0.45)'

// ── Slot types & arc definitions ────────────────────────────────
type SlotType = 'high' | 'mid' | 'low' | 'rig' | 'sub'

/**
 * Each arc defines the circular path slots are placed on:
 * - r: distance from ring center to slot center
 * - a0: angle of the first slot (degrees, 0°=right, -90°=top)
 * - a1: angle of the last slot
 * - n: max number of slots (defines the evenly-spaced grid)
 */
const ARCS: Record<SlotType, { r: number; a0: number; a1: number; n: number }> = {
	high: { r: 163, a0: -132, a1: -46, n: 8 },
	mid: { r: 165, a0: 195, a1: 107, n: 8 },
	low: { r: 167, a0: -14, a1: 72, n: 8 },
	rig: { r: 84, a0: 115, a1: 63, n: 3 },
	sub: { r: 84, a0: -142, a1: -63, n: 4 },
}

// ── Math helpers ────────────────────────────────────────────────
const RAD = Math.PI / 180
const cos = (d: number) => Math.cos(d * RAD)
const sin = (d: number) => Math.sin(d * RAD)
const r1 = (n: number) => Math.round(n * 10) / 10

// ── Position computation ────────────────────────────────────────
interface SlotPos {
	cx: number
	cy: number
	rot: number
	left: number
	top: number
}

/** Compute evenly-spaced positions on an arc. Returns all n grid positions. */
function arcPositions(arc: { r: number; a0: number; a1: number; n: number }): SlotPos[] {
	const { r, a0, a1, n } = arc
	if (n <= 0) return []
	const step = n === 1 ? 0 : (a1 - a0) / (n - 1)
	return Array.from({ length: n }, (_, i) => {
		const angle = a0 + i * step
		const cx = r1(CX + r * cos(angle))
		const cy = r1(CY + r * sin(angle))
		return { cx, cy, rot: r1(angle + 90), left: r1(cx - 16), top: r1(cy - 16) }
	})
}

// Pre-compute all slot positions (one grid per type)
const SLOT_POS: Record<SlotType, SlotPos[]> = {
	high: arcPositions(ARCS.high),
	mid: arcPositions(ARCS.mid),
	low: arcPositions(ARCS.low),
	rig: arcPositions(ARCS.rig),
	sub: arcPositions(ARCS.sub),
}

// ── Ring path builder ───────────────────────────────────────────
function polar(r: number, deg: number) {
	return { x: r1(CX + r * cos(deg)), y: r1(CY + r * sin(deg)) }
}

function buildRingPaths() {
	const norm = (a: number) => ((a % 360) + 360) % 360

	// ── Outer edge: 3 inward V-notches at divider angles (CW) ──
	const outerAngles = DIVIDER_ANGLES.map(norm).sort((a, b) => a - b) // [90, 211.5, 330]
	const oLast = outerAngles[outerAngles.length - 1]
	const osp = polar(OUTER_R, oLast + OUTER_NOTCH_HALF)
	let outer = `M ${osp.x} ${osp.y}`
	for (const a of outerAngles) {
		const pre = polar(OUTER_R, a - OUTER_NOTCH_HALF)
		outer += ` A ${OUTER_R} ${OUTER_R} 0 0 1 ${pre.x} ${pre.y}`
		const tip = polar(OUTER_NOTCH_TIP_R, a)
		outer += ` L ${tip.x} ${tip.y}`
		const post = polar(OUTER_R, a + OUTER_NOTCH_HALF)
		outer += ` L ${post.x} ${post.y}`
	}
	outer += ' Z'

	// ── Inner edge: 3 outward + 2 inward V-notches (CW) ──
	type Notch = { angle: number; tipR: number; half: number }
	const innerNotches: Notch[] = [
		...DIVIDER_ANGLES.map((a) => ({ angle: norm(a), tipR: INNER_OUTWARD_TIP_R, half: INNER_OUTWARD_HALF })),
		...INNER_INWARD_ANGLES.map((a) => ({ angle: norm(a), tipR: INNER_INWARD_TIP_R, half: INNER_INWARD_HALF })),
	].sort((a, b) => a.angle - b.angle)

	const iLast = innerNotches[innerNotches.length - 1]
	const isp = polar(INNER_R, iLast.angle + iLast.half)
	let inner = `M ${isp.x} ${isp.y}`
	for (const n of innerNotches) {
		const pre = polar(INNER_R, n.angle - n.half)
		inner += ` A ${INNER_R} ${INNER_R} 0 0 1 ${pre.x} ${pre.y}`
		const tip = polar(n.tipR, n.angle)
		inner += ` L ${tip.x} ${tip.y}`
		const post = polar(INNER_R, n.angle + n.half)
		inner += ` L ${post.x} ${post.y}`
	}
	inner += ' Z'

	return { ring: `${outer} ${inner}`, outer, inner }
}

const PATHS = buildRingPaths()

// ── Slot-type icons (drawn in 32×32 local coords) ──────────────
function HighSlotIcon() {
	// Y-shaped turret: 3 arms from center
	const cx = 16, cy = 16, len = 5.5
	return (
		<g stroke={ICON_FILL} strokeWidth={1.6} strokeLinecap="round" fill="none">
			{[270, 30, 150].map((a, i) => (
				<line key={i} x1={cx} y1={cy} x2={r1(cx + len * cos(a))} y2={r1(cy + len * sin(a))} />
			))}
		</g>
	)
}

function MidSlotIcon() {
	return (
		<g stroke={ICON_FILL} strokeWidth={1.8} strokeLinecap="round" fill="none">
			<line x1={11} y1={13.5} x2={21} y2={13.5} />
			<line x1={11} y1={18.5} x2={21} y2={18.5} />
		</g>
	)
}

function LowSlotIcon() {
	return (
		<line
			x1={11} y1={16} x2={21} y2={16}
			stroke={ICON_FILL} strokeWidth={2} strokeLinecap="round"
		/>
	)
}

function RigSlotIcon() {
	return (
		<g fill={ICON_FILL}>
			<circle cx={16} cy={12} r={1.8} />
			<circle cx={20} cy={16} r={1.8} />
			<circle cx={16} cy={20} r={1.8} />
			<circle cx={12} cy={16} r={1.8} />
		</g>
	)
}

function SubSlotIcon() {
	return (
		<g fill={ICON_FILL}>
			{[0, 1, 2, 3, 4].map((i) => {
				const a = -90 + i * 72
				return <circle key={i} cx={r1(16 + 5 * cos(a))} cy={r1(16 + 5 * sin(a))} r={1.5} />
			})}
		</g>
	)
}

const SLOT_ICON: Record<SlotType, () => React.JSX.Element> = {
	high: HighSlotIcon,
	mid: MidSlotIcon,
	low: LowSlotIcon,
	rig: RigSlotIcon,
	sub: SubSlotIcon,
}

// ── Slot marker (rotated rect + icon) ───────────────────────────
function SlotMarker({ pos, type }: { pos: SlotPos; type: SlotType }) {
	const Icon = SLOT_ICON[type]
	return (
		<g transform={`translate(${pos.cx},${pos.cy}) rotate(${pos.rot}) translate(-16,-16)`}>
			<rect width={SS} height={SS} rx={2} ry={2} fill="none" stroke={SLOT_STROKE} strokeWidth={1} />
			<Icon />
		</g>
	)
}

// ── Item grouping ───────────────────────────────────────────────
const FLAG_MAP: Record<string, SlotType> = {
	'High Slot': 'high',
	'Mid Slot': 'mid',
	'Low Slot': 'low',
	'Rig Slot': 'rig',
	'Subsystem Slot': 'sub',
}

function groupBySlot(items: FittingItem[]) {
	const groups: Record<SlotType, FittingItem[]> = { high: [], mid: [], low: [], rig: [], sub: [] }
	for (const item of items) {
		const type = FLAG_MAP[item.flagName]
		if (type) groups[type].push(item)
	}
	return groups
}

// ── Main component ──────────────────────────────────────────────
interface FittingPanelProps {
	fittingItems: FittingItem[]
	shipTypeId: string
	shipName: string
}

export function FittingPanel({ fittingItems, shipTypeId, shipName }: FittingPanelProps) {
	const groups = groupBySlot(fittingItems)

	const counts: Record<SlotType, number> = {
		high: Math.min(groups.high.length, ARCS.high.n),
		mid: Math.min(groups.mid.length, ARCS.mid.n),
		low: Math.min(groups.low.length, ARCS.low.n),
		rig: Math.min(groups.rig.length, ARCS.rig.n),
		sub: Math.min(groups.sub.length, ARCS.sub.n),
	}

	return (
		<div className="flex justify-center">
			<div className="relative" style={{ width: P, height: P }}>
				{/* Ship render — behind the ring */}
				<img
					src={eveRender(shipTypeId)}
					alt={shipName}
					title={shipName}
					className="absolute rounded"
					style={{ width: SHIP_SZ, height: SHIP_SZ, left: SHIP_X, top: SHIP_Y, zIndex: 1, clipPath: `circle(${INNER_OUTWARD_TIP_R}px at ${CX - SHIP_X}px ${CY - SHIP_Y}px)` }}
				/>

				{/* SVG: ring + slot markers */}
				<svg
					viewBox={`0 0 ${P} ${P}`}
					width={P}
					height={P}
					className="absolute inset-0 rounded"
					style={{ zIndex: 2 }}
				>
					{/* Ring body (dark fill, transparent center cutout) */}
					<path d={PATHS.ring} fill={RING_FILL} fillRule="evenodd" />

					{/* Outer border — follows indented outer edge */}
					<path d={PATHS.outer} fill="none" stroke="#9a9a9a" strokeWidth={BEVEL} />

					{/* Inner border — follows notched inner edge */}
					<path d={PATHS.inner} fill="none" stroke="#9a9a9a" strokeWidth={BEVEL} />

					{/* Slot markers (arc-computed positions) */}
					{(Object.keys(ARCS) as SlotType[]).flatMap((type) =>
						SLOT_POS[type].slice(0, counts[type]).map((pos, i) => (
							<SlotMarker key={`${type}${i}`} pos={pos} type={type} />
						))
					)}
				</svg>

				{/* Module icons (HTML img, on top of everything) */}
				{(Object.keys(ARCS) as SlotType[]).flatMap((type) =>
					groups[type].slice(0, counts[type]).map((item, i) => {
						const pos = SLOT_POS[type][i]
						if (!pos) return null
						return (
							<img
								key={`mod-${type}${i}`}
								src={eveIcon(item.typeId)}
								alt={item.typeName}
								title={item.typeName}
								className="absolute rounded"
								style={{ width: SS, height: SS, left: pos.left, top: pos.top, zIndex: 4 }}
							/>
						)
					})
				)}
			</div>
		</div>
	)
}
