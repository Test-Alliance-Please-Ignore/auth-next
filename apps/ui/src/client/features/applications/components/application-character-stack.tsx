import { useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { characterPortraitUrl } from '@/lib/eve-images'

import { CharacterRoleBadge } from './character-role-badge'

// ============================================================================
// Types & config
// ============================================================================

export interface ApplicationCharacterStackProps {
	mainCharacterId: string
	mainCharacterName: string
	altCharacterIds: string[]
	altCharacterNames: Record<string, string>
	size?: 'sm' | 'md' | 'lg'
}

/** Max alt portraits rendered with actual images; any beyond this get a blank placeholder */
const MAX_PORTRAIT_ALTS = 3

interface SizeConfig {
	mainPx: number
	portraitPx: 32 | 64
	altDecrement: number
	xStep: number
	yStep: number
}

const configs: Record<'sm' | 'md' | 'lg', SizeConfig> = {
	lg: { mainPx: 64, portraitPx: 64, altDecrement: 8, xStep: 18, yStep: 6 },
	md: { mainPx: 48, portraitPx: 64, altDecrement: 6, xStep: 14, yStep: 5 },
	sm: { mainPx: 32, portraitPx: 32, altDecrement: 4, xStep: 10, yStep: 3 },
}

// ============================================================================
// Helpers
// ============================================================================

function altPx(cfg: SizeConfig, i: number) {
	return Math.max(cfg.mainPx - cfg.altDecrement * (i + 1), 16)
}

function altPos(cfg: SizeConfig, i: number) {
	return { x: cfg.xStep * (i + 1), y: cfg.yStep * (i + 1) }
}

/**
 * Placeholder advances by (sizeRatio × step) from the last portrait so that
 * the visible peek is the same proportion of its width as the other alts.
 * sizeRatio = placeholderPx / lastAltPx = 0.8 for all size configs.
 */
function placeholderPos(cfg: SizeConfig) {
	const last = altPos(cfg, MAX_PORTRAIT_ALTS - 1)
	const sizeRatio = altPx(cfg, MAX_PORTRAIT_ALTS) / altPx(cfg, MAX_PORTRAIT_ALTS - 1)
	return {
		x: last.x + Math.round(cfg.xStep * sizeRatio),
		y: last.y + Math.round(cfg.yStep * sizeRatio),
	}
}

function containerSize(cfg: SizeConfig, visibleCount: number, hasPlaceholder: boolean): { width: number; height: number } {
	let w = cfg.mainPx
	let h = cfg.mainPx

	for (let i = 0; i < visibleCount; i++) {
		const { x, y } = altPos(cfg, i)
		const px = altPx(cfg, i)
		w = Math.max(w, x + px)
		h = Math.max(h, y + px)
	}

	if (hasPlaceholder) {
		const { x, y } = placeholderPos(cfg)
		const px = altPx(cfg, MAX_PORTRAIT_ALTS)
		w = Math.max(w, x + px)
		h = Math.max(h, y + px)
	}

	return { width: w + 6, height: h + 6 }
}

// ============================================================================
// Component
// ============================================================================

export function ApplicationCharacterStack({
	mainCharacterId,
	mainCharacterName,
	altCharacterIds,
	altCharacterNames,
	size = 'lg',
}: ApplicationCharacterStackProps) {
	const [open, setOpen] = useState(false)
	const closeTimeoutRef = useRef<number | null>(null)

	const cfg = configs[size]
	const altCount = altCharacterIds.length
	const visibleAlts = altCharacterIds.slice(0, MAX_PORTRAIT_ALTS)
	// Show a blank placeholder slot when there are more alts than we can show as portraits
	const showPlaceholder = altCount > MAX_PORTRAIT_ALTS
	const { width: cw, height: ch } = containerSize(cfg, visibleAlts.length, showPlaceholder)

	const clearClose = () => {
		if (closeTimeoutRef.current !== null) {
			window.clearTimeout(closeTimeoutRef.current)
			closeTimeoutRef.current = null
		}
	}

	const openPopover = () => { clearClose(); setOpen(true) }
	const closePopoverSoon = () => {
		clearClose()
		closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 80)
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<div
					className="relative flex-shrink-0 cursor-default"
					style={{ width: cw, height: ch }}
					onMouseEnter={openPopover}
					onMouseLeave={closePopoverSoon}
					onFocus={openPopover}
					onBlur={closePopoverSoon}
				>
					{/* Blank placeholder slot (behind all portraits) — shown when 4+ alts */}
					{showPlaceholder && (() => {
						const { x, y } = placeholderPos(cfg)
						const px = altPx(cfg, MAX_PORTRAIT_ALTS)
						return (
							<div
								style={{ position: 'absolute', left: x, top: y, width: px, height: px, zIndex: 0 }}
								className="rounded border-2 border-background bg-muted shadow-md"
							/>
						)
					})()}

					{/* Alt portraits — rendered back-to-front so earlier alts sit in front */}
					{[...visibleAlts].reverse().map((altId, reverseIdx) => {
						const i = visibleAlts.length - 1 - reverseIdx
						const { x, y } = altPos(cfg, i)
						const px = altPx(cfg, i)
						return (
							<img
								key={altId}
								src={characterPortraitUrl(altId, 32)}
								alt={altCharacterNames[altId] ?? altId}
								style={{
									position: 'absolute',
									left: x,
									top: y,
									width: px,
									height: px,
									zIndex: MAX_PORTRAIT_ALTS - i,
								}}
								className="rounded object-cover border-2 border-background shadow-md"
								loading="lazy"
							/>
						)
					})}

					{/* Main portrait — frontmost */}
					<img
						src={characterPortraitUrl(mainCharacterId, cfg.portraitPx)}
						alt={mainCharacterName}
						style={{
							position: 'absolute',
							left: 0,
							top: 0,
							width: cfg.mainPx,
							height: cfg.mainPx,
							zIndex: MAX_PORTRAIT_ALTS + 1,
						}}
						className="rounded object-cover shadow-lg"
						loading="lazy"
					/>

					{/* Persistent alt count badge — anchored to bottom-right corner of main portrait */}
					{altCount > 0 && (
						<Badge
							variant="default"
							style={{
								position: 'absolute',
								left: cfg.mainPx,
								top: cfg.mainPx,
								transform: 'translate(-100%, -100%)',
								zIndex: MAX_PORTRAIT_ALTS + 2,
							}}
							className="px-1 py-0 text-[10px] leading-4 shadow-sm"
						>
							+{altCount}
						</Badge>
					)}
				</div>
			</PopoverTrigger>

			<PopoverContent
				side="right"
				align="start"
				sideOffset={12}
				onMouseEnter={openPopover}
				onMouseLeave={closePopoverSoon}
			>
				<div className="space-y-3 min-w-[200px]">
					<div>
						<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
							Main Character
						</p>
						<div className="flex items-center gap-2">
							<img
								src={characterPortraitUrl(mainCharacterId, 32)}
								alt={mainCharacterName}
								className="h-8 w-8 rounded object-cover"
								loading="lazy"
							/>
							<span className="inline-flex min-w-0 items-center gap-2">
								<span className="truncate text-sm font-medium">{mainCharacterName}</span>
								<CharacterRoleBadge role="main" />
							</span>
						</div>
					</div>

					{altCount > 0 && (
						<>
							<Separator />
							<div>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
									Alt Characters ({altCount})
								</p>
								<div className="space-y-2">
									{altCharacterIds.map((altId) => (
										<div key={altId} className="flex items-center gap-2">
											<img
												src={characterPortraitUrl(altId, 32)}
												alt={altCharacterNames[altId] ?? altId}
												className="h-8 w-8 rounded object-cover"
												loading="lazy"
											/>
											<span className="inline-flex min-w-0 items-center gap-2">
												<span className="truncate text-sm">{altCharacterNames[altId] ?? altId}</span>
												<CharacterRoleBadge role="alt" />
											</span>
										</div>
									))}
								</div>
							</div>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
