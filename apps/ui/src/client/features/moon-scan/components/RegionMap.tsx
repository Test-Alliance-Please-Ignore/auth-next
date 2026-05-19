import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { JumpLink, RegionSystemEntry } from '../types'

interface DotlanCoords {
	region: string
	viewbox: [number, number, number, number]
	systems: Record<string, [number, number]>
}

interface Props {
	systems: RegionSystemEntry[]
	jumpLinks: JumpLink[]
	coords: DotlanCoords
	borderRegions: Record<string, { regionId: string; regionName: string }>
}

// Dotlan system node dimensions (matching old tool).
// Dotlan coords are the top-left corner of a 58×29 bounding cell.
// The visual rect center is at coord + (OX, OY).
const RW = 58
const RH = 16
const OX = 29    // half cell width → horizontal center
const OY = 14.5  // cell center height (rect at y+3.5, size 22, center = y+14.5)

function sysFill(moonCount: number, verifiedCount: number, scannedCount: number): string {
	if (moonCount === 0) return '#151c24'
	if (verifiedCount === moonCount) return '#1a3320'
	if (verifiedCount > 0 || scannedCount > 0) return '#332a10'
	return '#1e2830'
}

function sysStroke(moonCount: number, verifiedCount: number, scannedCount: number): string {
	if (moonCount === 0) return '#2a3644'
	if (verifiedCount === moonCount) return '#28a745'
	if (verifiedCount > 0 || scannedCount > 0) return '#c89b20'
	return '#4a5a6a'
}

function nameColor(moonCount: number): string {
	return moonCount === 0 ? '#4a5a6a' : '#c8d4e0'
}

function secLabel(secStatus: string | null): string {
	if (secStatus === null) return '?'
	const s = parseFloat(secStatus)
	return Math.max(0, s).toFixed(1)
}

interface TooltipState {
	name: string
	sec: string
	moonCount: number
	verifiedCount: number
	scannedCount: number
}

export function RegionMap({ systems, jumpLinks, coords, borderRegions = {} }: Props) {
	const navigate = useNavigate()
	const [tooltip, setTooltip] = useState<TooltipState | null>(null)
	const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

	const systemMap = new Map(systems.map((s) => [s.solarSystemId, s]))
	const systemIds = new Set(systems.map((s) => s.solarSystemId))
	const coordSystems: Record<string, [number, number]> = coords.systems ?? {}
	// Border nodes = systems in the dotlan JSON that aren't in this region,
	// but only those with an actual stargate connection in jumpLinks.
	const borderSystemIds = new Set(
		jumpLinks.flatMap((l) => [l.from, l.to]).filter((id) => !systemIds.has(id) && id in coordSystems)
	)
	// Expand the viewbox so nodes at the edges get equal breathing room on all sides.
	const PAD = 20
	const allCoords = Object.values(coordSystems)
	const minX = (allCoords.length ? Math.min(...allCoords.map((p) => p[0])) : 0) - RW / 2 - PAD
	const minY = (allCoords.length ? Math.min(...allCoords.map((p) => p[1])) : 0) + OY - RH / 2 - PAD
	const maxX = (allCoords.length ? Math.max(...allCoords.map((p) => p[0])) : 1024) + RW / 2 + PAD
	const maxY = (allCoords.length ? Math.max(...allCoords.map((p) => p[1])) : 768) + OY + RH / 2 + PAD
	const [vx, vy, vw, vh] = [minX, minY, maxX - minX, maxY - minY]

	function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
		const br = e.currentTarget.getBoundingClientRect()
		const x = Math.min(e.clientX - br.left + 14, br.width - 220)
		const y = e.clientY - br.top - 10
		setTooltipPos({ x, y })
	}

	return (
		<div
			className="relative overflow-auto rounded-md border"
			style={{ background: '#0b1218' }}
			onMouseMove={handleMouseMove}
			onMouseLeave={() => setTooltip(null)}
		>
			<svg
				viewBox={`${vx} ${vy} ${vw} ${vh}`}
				className="block w-full"
				style={{ minWidth: '600px', maxHeight: '75vh' }}
				preserveAspectRatio="xMidYMid meet"
			>
				{/* Jump links — intra-region and cross-region border links */}
				{jumpLinks.map((link, i) => {
					const fromIsBorder = borderSystemIds.has(link.from)
					const toIsBorder = borderSystemIds.has(link.to)
					// Skip if neither end is in the dotlan coords
					if (!systemIds.has(link.from) && !fromIsBorder) return null
					if (!systemIds.has(link.to) && !toIsBorder) return null
					const fromPos = coordSystems[link.from]
					const toPos = coordSystems[link.to]
					if (!fromPos || !toPos) return null
					const isBorderLink = fromIsBorder || toIsBorder
					return (
						<line
							key={i}
							x1={fromPos[0] + OX}
							y1={fromPos[1] + OY}
							x2={toPos[0] + OX}
							y2={toPos[1] + OY}
							stroke={isBorderLink ? '#4a6a8a' : '#2a3a4a'}
							strokeWidth={1}
							strokeDasharray={isBorderLink ? '3 2' : undefined}
						/>
					)
				})}

				{/* Border nodes — neighboring-region systems shown as exit indicators */}
				{[...borderSystemIds].map((sysId) => {
					const pos = coordSystems[sysId]
					if (!pos) return null
					const region = borderRegions[sysId]
					const cx = pos[0] + OX
					const cy = pos[1] + OY
					return (
						<g
							key={`border-${sysId}`}
							style={{ cursor: region ? 'pointer' : 'default' }}
							onClick={() => region && navigate(`/moon-scan/region/${region.regionId}`)}
						>
							<rect
								x={cx - RW / 2}
								y={cy - RH / 2}
								width={RW}
								height={RH}
								rx={4}
								ry={4}
								fill="#0d1a26"
								stroke="#3a5a7a"
								strokeWidth={1}
								strokeDasharray="3 2"
							/>
							<text
								x={cx}
								y={cy}
								textAnchor="middle"
								dominantBaseline="central"
								fontSize={6}
								fontFamily="Arial, Helvetica, sans-serif"
								fill="#4a8aaa"
								style={{ pointerEvents: 'none' }}
							>
								{region ? region.regionName : '?'}
							</text>
						</g>
					)
				})}

				{/* System nodes */}
				{Object.entries(coordSystems).map(([sysId, pos]) => {
					const sys = systemMap.get(sysId)
					if (!sys) return null

					const cx = pos[0] + OX
					const cy = pos[1] + OY
					const sec = sys.securityStatus !== null ? parseFloat(sys.securityStatus) : -1
					const eligible = sec < 0.6
					const fill = sysFill(sys.moonCount, sys.verifiedCount, sys.scannedCount)
					const stroke = sysStroke(sys.moonCount, sys.verifiedCount, sys.scannedCount)
					const textColor = nameColor(sys.moonCount)
					const clipId = `clip-sys-${sysId}`

					return (
						<g
							key={sysId}
							style={{ cursor: eligible ? 'pointer' : 'default' }}
							onClick={() => eligible && navigate(`/moon-scan/system/${sysId}`)}
							onMouseEnter={() =>
								setTooltip({
									name: sys.solarSystemName,
									sec: secLabel(sys.securityStatus),
									moonCount: sys.moonCount,
									verifiedCount: sys.verifiedCount,
									scannedCount: sys.scannedCount,
								})
							}
							onMouseLeave={() => setTooltip(null)}
						>
							<clipPath id={clipId}>
								<rect x={cx - RW / 2 + 2} y={cy - RH / 2} width={RW - 4} height={RH} />
							</clipPath>
							<rect
								x={cx - RW / 2}
								y={cy - RH / 2}
								width={RW}
								height={RH}
								rx={8}
								ry={8}
								fill={fill}
								stroke={stroke}
								strokeWidth={1}
							/>
							<text
								x={cx}
								y={cy}
								textAnchor="middle"
								dominantBaseline="central"
								fontSize={7}
								fontFamily="Arial, Helvetica, sans-serif"
								fill={textColor}
								clipPath={`url(#${clipId})`}
								style={{ pointerEvents: 'none' }}
							>
								{sys.solarSystemName}
							</text>
						</g>
					)
				})}
			</svg>

			{/* Tooltip */}
			{tooltip && (
				<div
					style={{
						position: 'absolute',
						left: tooltipPos.x,
						top: tooltipPos.y,
						background: 'rgba(14,22,32,0.95)',
						border: '1px solid #3d9ae8',
						color: '#d0d8e0',
						padding: '6px 10px',
						borderRadius: 4,
						fontSize: '0.8rem',
						pointerEvents: 'none',
						whiteSpace: 'nowrap',
						zIndex: 10,
					}}
				>
					<span style={{ color: '#3d9ae8', fontWeight: 600 }}>{tooltip.name}</span>
					{' '}
					<span style={{ color: '#6b7c8f' }}>({tooltip.sec})</span>
					{tooltip.moonCount > 0 ? (
						<>
							<br />
							<span style={{ color: '#6b7c8f' }}>Moons: </span>
							{tooltip.moonCount}
							{'  '}
							<span style={{ color: '#6b7c8f' }}>Verified: </span>
							{tooltip.verifiedCount}
							{' '}({tooltip.moonCount > 0 ? Math.round(tooltip.verifiedCount / tooltip.moonCount * 100) : 0}%)
						</>
					) : null}
				</div>
			)}

			{/* Legend */}
			<div className="flex flex-wrap items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-8 rounded" style={{ background: '#1a3320', border: '1px solid #28a745' }} />
					100% Verified
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-8 rounded" style={{ background: '#332a10', border: '1px solid #c89b20' }} />
					Partially Scanned
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-8 rounded" style={{ background: '#1e2830', border: '1px solid #4a5a6a' }} />
					Has Moons
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-8 rounded" style={{ background: '#151c24', border: '1px solid #2a3644' }} />
					No Moons
				</span>
				<span className="flex items-center gap-1.5">
					<span className="inline-block h-3 w-8 rounded" style={{ background: '#0d1a26', border: '1px dashed #3a5a7a' }} />
					Other Region
				</span>
				<span className="text-muted-foreground/60">Click eligible system to view details</span>
			</div>
		</div>
	)
}
