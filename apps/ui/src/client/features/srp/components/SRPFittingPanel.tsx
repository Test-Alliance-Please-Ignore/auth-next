/**
 * SRP-specific circular fitting panel (SVG).
 * Independent of the doctrine FittingPanel — evolved separately for SRP enrichments.
 * Supports both ship and pod geometry (detected by shipTypeId).
 */

import { typeIconUrl, typeRenderUrl } from '@/lib/eve-images'

import { isPodLoss } from '../utils/fitting'

import type { SRPFittingItem } from '../utils/fitting'

const eveIcon = (typeId: string) => typeIconUrl(typeId, 32)
const eveRender = (typeId: string, size: 512 | 256 = 512) => typeRenderUrl(typeId, size)

// ── Core geometry ───────────────────────────────────────────────
const P = 398
const CX = 199
const CY = 199
const OUTER_R = 196
const INNER_R = 130

const DIVIDER_ANGLES = [-30, 90, 211.5]
const OUTER_NOTCH_TIP_R = 184
const OUTER_NOTCH_HALF = 7
const INNER_OUTWARD_TIP_R = 148
const INNER_OUTWARD_HALF = 10
const INNER_INWARD_TIP_R = 116
const INNER_INWARD_HALF = 9
const INNER_INWARD_ANGLES = [50, 130]
const BEVEL = 5
const SS = 32
const SHIP_SZ = 300
const SHIP_X = 49
const SHIP_Y = 49

const RING_FILL = '#1a1a1e'
const SLOT_STROKE = 'rgba(200,200,200,0.6)'
const ICON_FILL = 'rgba(180,180,180,0.45)'

// ── Arc definitions ─────────────────────────────────────────────
type ShipSlotType = 'high' | 'mid' | 'low' | 'rig' | 'sub'
type PodSlotType = 'implant_top' | 'implant_bottom'

const SHIP_ARCS: Record<ShipSlotType, { r: number; a0: number; a1: number; n: number }> = {
	high: { r: 163, a0: -132, a1: -46, n: 8 },
	mid: { r: 165, a0: 195, a1: 107, n: 8 },
	low: { r: 167, a0: -14, a1: 72, n: 8 },
	rig: { r: 84, a0: 115, a1: 63, n: 3 },
	sub: { r: 84, a0: -142, a1: -63, n: 4 },
}

// Pod uses implant slots in high (top) and low (bottom) arc positions
const POD_ARCS: Record<PodSlotType, { r: number; a0: number; a1: number; n: number }> = {
	implant_top: { r: 163, a0: -132, a1: -46, n: 5 },
	implant_bottom: { r: 167, a0: -14, a1: 72, n: 5 },
}

// ── Math helpers ────────────────────────────────────────────────
const RAD = Math.PI / 180
const cos = (d: number) => Math.cos(d * RAD)
const sin = (d: number) => Math.sin(d * RAD)
const r1 = (n: number) => Math.round(n * 10) / 10

interface SlotPos {
	cx: number
	cy: number
	rot: number
	left: number
	top: number
}

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

const SHIP_SLOT_POS: Record<ShipSlotType, SlotPos[]> = {
	high: arcPositions(SHIP_ARCS.high),
	mid: arcPositions(SHIP_ARCS.mid),
	low: arcPositions(SHIP_ARCS.low),
	rig: arcPositions(SHIP_ARCS.rig),
	sub: arcPositions(SHIP_ARCS.sub),
}

const POD_SLOT_POS: Record<PodSlotType, SlotPos[]> = {
	implant_top: arcPositions(POD_ARCS.implant_top),
	implant_bottom: arcPositions(POD_ARCS.implant_bottom),
}

// ── Ring path builder ───────────────────────────────────────────
function polar(r: number, deg: number) {
	return { x: r1(CX + r * cos(deg)), y: r1(CY + r * sin(deg)) }
}

function buildRingPaths() {
	const norm = (a: number) => ((a % 360) + 360) % 360

	const outerAngles = DIVIDER_ANGLES.map(norm).sort((a, b) => a - b)
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

	type Notch = { angle: number; tipR: number; half: number }
	const innerNotches: Notch[] = [
		...DIVIDER_ANGLES.map((a) => ({
			angle: norm(a),
			tipR: INNER_OUTWARD_TIP_R,
			half: INNER_OUTWARD_HALF,
		})),
		...INNER_INWARD_ANGLES.map((a) => ({
			angle: norm(a),
			tipR: INNER_INWARD_TIP_R,
			half: INNER_INWARD_HALF,
		})),
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

// ── Slot type icons ──────────────────────────────────────────────
function HighSlotIcon() {
	const cx = 16,
		cy = 16,
		len = 5.5
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
			x1={11}
			y1={16}
			x2={21}
			y2={16}
			stroke={ICON_FILL}
			strokeWidth={2}
			strokeLinecap="round"
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

function ImplantSlotIcon() {
	return (
		<g stroke={ICON_FILL} strokeWidth={1.6} strokeLinecap="round" fill="none">
			<circle cx={16} cy={16} r={5} />
			<line x1={16} y1={9} x2={16} y2={23} />
		</g>
	)
}

function SlotMarker({ pos, icon }: { pos: SlotPos; icon: () => React.JSX.Element }) {
	const Icon = icon
	return (
		<g transform={`translate(${pos.cx},${pos.cy}) rotate(${pos.rot}) translate(-16,-16)`}>
			<rect width={SS} height={SS} rx={2} ry={2} fill="none" stroke={SLOT_STROKE} strokeWidth={1} />
			<Icon />
		</g>
	)
}

// ── Main component ───────────────────────────────────────────────
interface SRPFittingPanelProps {
	shipTypeId: string
	shipTypeName?: string
	items: SRPFittingItem[]
}

export function SRPFittingPanel({ shipTypeId, shipTypeName, items }: SRPFittingPanelProps) {
	const isPod = isPodLoss(shipTypeId)

	if (isPod) {
		return <PodFittingPanel shipTypeId={shipTypeId} shipTypeName={shipTypeName} items={items} />
	}

	return <ShipFittingPanel shipTypeId={shipTypeId} shipTypeName={shipTypeName} items={items} />
}

function ShipFittingPanel({ shipTypeId, shipTypeName, items }: SRPFittingPanelProps) {
	const groups: Record<ShipSlotType, SRPFittingItem[]> = {
		high: [],
		mid: [],
		low: [],
		rig: [],
		sub: [],
	}
	for (const item of items) {
		if (item.slotType === 'implant') continue
		if (item.slotType in groups) groups[item.slotType as ShipSlotType].push(item)
	}

	const counts = (Object.keys(groups) as ShipSlotType[]).reduce(
		(acc, t) => ({ ...acc, [t]: Math.min(groups[t].length, SHIP_ARCS[t].n) }),
		{} as Record<ShipSlotType, number>
	)

	const slotIcons: Record<ShipSlotType, () => React.JSX.Element> = {
		high: HighSlotIcon,
		mid: MidSlotIcon,
		low: LowSlotIcon,
		rig: RigSlotIcon,
		sub: SubSlotIcon,
	}

	return (
		<div className="flex justify-center">
			<div className="relative" style={{ width: P, height: P }}>
				<img
					src={eveRender(shipTypeId)}
					alt={shipTypeName ?? shipTypeId}
					title={shipTypeName}
					className="absolute rounded"
					style={{
						width: SHIP_SZ,
						height: SHIP_SZ,
						left: SHIP_X,
						top: SHIP_Y,
						zIndex: 1,
						clipPath: `circle(${INNER_OUTWARD_TIP_R}px at ${CX - SHIP_X}px ${CY - SHIP_Y}px)`,
					}}
				/>
				<svg
					viewBox={`0 0 ${P} ${P}`}
					width={P}
					height={P}
					className="absolute inset-0 rounded"
					style={{ zIndex: 2 }}
				>
					<path d={PATHS.ring} fill={RING_FILL} fillRule="evenodd" />
					<path d={PATHS.outer} fill="none" stroke="#9a9a9a" strokeWidth={BEVEL} />
					<path d={PATHS.inner} fill="none" stroke="#9a9a9a" strokeWidth={BEVEL} />
					{(Object.keys(SHIP_ARCS) as ShipSlotType[]).flatMap((type) =>
						SHIP_SLOT_POS[type]
							.slice(0, counts[type])
							.map((pos, i) => <SlotMarker key={`${type}${i}`} pos={pos} icon={slotIcons[type]} />)
					)}
				</svg>
				{(Object.keys(SHIP_ARCS) as ShipSlotType[]).flatMap((type) =>
					groups[type].slice(0, counts[type]).map((item, i) => {
						const pos = SHIP_SLOT_POS[type][i]
						if (!pos) return null
						return (
							<img
								key={`mod-${type}${i}`}
								src={eveIcon(item.typeId)}
								alt={item.typeName}
								title={`${item.typeName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`}
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

function PodFittingPanel({ shipTypeId, shipTypeName, items }: SRPFittingPanelProps) {
	// Implant slots 0-4 → top arc; 5-9 → bottom arc
	const topImplants = items.filter((i) => i.slotType === 'implant' && i.slotIndex < 5)
	const bottomImplants = items.filter((i) => i.slotType === 'implant' && i.slotIndex >= 5)

	const topCount = Math.min(topImplants.length, POD_ARCS.implant_top.n)
	const bottomCount = Math.min(bottomImplants.length, POD_ARCS.implant_bottom.n)

	return (
		<div className="flex justify-center">
			<div className="relative" style={{ width: P, height: P }}>
				<img
					src={eveRender(shipTypeId)}
					alt={shipTypeName ?? 'Capsule'}
					title={shipTypeName}
					className="absolute rounded"
					style={{
						width: SHIP_SZ,
						height: SHIP_SZ,
						left: SHIP_X,
						top: SHIP_Y,
						zIndex: 1,
						clipPath: `circle(${INNER_OUTWARD_TIP_R}px at ${CX - SHIP_X}px ${CY - SHIP_Y}px)`,
					}}
				/>
				<svg
					viewBox={`0 0 ${P} ${P}`}
					width={P}
					height={P}
					className="absolute inset-0 rounded"
					style={{ zIndex: 2 }}
				>
					<path d={PATHS.ring} fill={RING_FILL} fillRule="evenodd" />
					<path d={PATHS.outer} fill="none" stroke="#9a9a9a" strokeWidth={BEVEL} />
					<path d={PATHS.inner} fill="none" stroke="#9a9a9a" strokeWidth={BEVEL} />
					{POD_SLOT_POS.implant_top.slice(0, topCount).map((pos, i) => (
						<SlotMarker key={`top${i}`} pos={pos} icon={ImplantSlotIcon} />
					))}
					{POD_SLOT_POS.implant_bottom.slice(0, bottomCount).map((pos, i) => (
						<SlotMarker key={`bot${i}`} pos={pos} icon={ImplantSlotIcon} />
					))}
				</svg>
				{topImplants.slice(0, topCount).map((item, i) => {
					const pos = POD_SLOT_POS.implant_top[i]
					if (!pos) return null
					return (
						<img
							key={`ti${i}`}
							src={eveIcon(item.typeId)}
							alt={item.typeName}
							title={item.typeName}
							className="absolute rounded"
							style={{ width: SS, height: SS, left: pos.left, top: pos.top, zIndex: 4 }}
						/>
					)
				})}
				{bottomImplants.slice(0, bottomCount).map((item, i) => {
					const pos = POD_SLOT_POS.implant_bottom[i]
					if (!pos) return null
					return (
						<img
							key={`bi${i}`}
							src={eveIcon(item.typeId)}
							alt={item.typeName}
							title={item.typeName}
							className="absolute rounded"
							style={{ width: SS, height: SS, left: pos.left, top: pos.top, zIndex: 4 }}
						/>
					)
				})}
			</div>
		</div>
	)
}
