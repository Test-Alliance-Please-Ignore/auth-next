/**
 * Clones Section - Jump clones grouped by location with expandable details,
 * plus active implants and home station info.
 */

import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'

// ============================================================================
// Types (matching ProcessedClones from the enrichment helper)
// ============================================================================

interface ProcessedJumpClone {
	implants: string[]
	jump_clone_id: string
	location_id: string
	location_type: 'station' | 'structure'
	name?: string
	locationName?: string
	implantNames: string[]
}

interface ProcessedClones {
	home_location?: {
		location_id: string
		location_type: 'station' | 'structure'
		locationName?: string
	}
	jump_clones: ProcessedJumpClone[]
	last_clone_jump_date?: string
	last_station_change_date?: string
	active_implants: Array<{
		type_id: string
		name?: string
	}>
}

interface LocationGroup {
	locationName: string
	clones: ProcessedJumpClone[]
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(dateStr?: string): string {
	if (!dateStr) return i18n.t('hrpages.never')
	const date = new Date(dateStr)
	return date.toLocaleDateString(getActiveLocale(), {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

// Sort implants by slot number extracted from name (Slot 1 first)
function sortImplants(implants: Array<{ name?: string; type_id?: string }>): typeof implants {
	return [...implants].sort((a, b) => {
		const slotA = a.name?.match(/Slot (\d+)/)?.[1]
		const slotB = b.name?.match(/Slot (\d+)/)?.[1]
		if (slotA && slotB) return Number(slotA) - Number(slotB)
		if (slotA) return -1
		if (slotB) return 1
		return (a.name ?? '').localeCompare(b.name ?? '')
	})
}

// ============================================================================
// Sub-components
// ============================================================================

function ImplantList({ implants, implantNames }: { implants: string[]; implantNames: string[] }) {
	const { t } = useAppTranslation()

	if (implants.length === 0) {
		return <p className="text-xs text-muted-foreground italic">{t('hrpages.noImplants')}</p>
	}

	const items = implants.map((id, idx) => ({
		type_id: id,
		name: implantNames[idx] ?? id,
	}))

	const sorted = sortImplants(items)

	return (
		<ul className="space-y-0.5">
			{sorted.map((item) => (
				<li key={item.type_id} className="text-xs text-foreground/80">
					{item.name}
				</li>
			))}
		</ul>
	)
}

function CloneRow({
	clone,
	isExpanded,
	onToggle,
}: {
	clone: ProcessedJumpClone
	isExpanded: boolean
	onToggle: () => void
}) {
	const { t } = useAppTranslation()

	return (
		<div className="rounded-md border">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
			>
				{isExpanded ? (
					<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
				) : (
					<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
				)}
				<div className="flex-1 min-w-0">
					<span className="font-medium text-sm">
						{clone.name || t('hrpages.cloneValue1', { value1: clone.jump_clone_id })}
					</span>
				</div>
				<Badge variant="secondary" className="text-[10px] shrink-0">
					{t('hrpages.implantCount', { count: clone.implants.length })}
				</Badge>
			</button>

			{isExpanded && (
				<div className="border-t px-4 py-3">
					<ImplantList implants={clone.implants} implantNames={clone.implantNames} />
				</div>
			)}
		</div>
	)
}

// ============================================================================
// Main Component
// ============================================================================

interface ClonesSectionProps {
	data: ProcessedClones
}

export function ClonesSection({ data }: ClonesSectionProps) {
	const { t } = useAppTranslation()

	const [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set())
	const [expandedClones, setExpandedClones] = useState<Set<string>>(new Set())
	const [search, setSearch] = useState('')

	const groups = useMemo(() => {
		const q = search.toLowerCase()
		const filtered = search
			? data.jump_clones.filter(
					(c) =>
						c.name?.toLowerCase().includes(q) ||
						c.locationName?.toLowerCase().includes(q) ||
						c.implantNames.some((n) => n.toLowerCase().includes(q))
				)
			: data.jump_clones

		const map = new Map<string, ProcessedJumpClone[]>()
		for (const clone of filtered) {
			const loc = clone.locationName || t('hrpages.unknownValue1', { value1: clone.location_id })
			const existing = map.get(loc)
			if (existing) {
				existing.push(clone)
			} else {
				map.set(loc, [clone])
			}
		}

		const result: LocationGroup[] = []
		for (const [locationName, clones] of map) {
			result.push({
				locationName,
				clones: clones.sort((a, b) => {
					if (a.name && !b.name) return -1
					if (!a.name && b.name) return 1
					return (a.name ?? '').localeCompare(b.name ?? '')
				}),
			})
		}
		return result.sort((a, b) => b.clones.length - a.clones.length)
	}, [data.jump_clones, search, t])

	const sortedActiveImplants = useMemo(
		() => sortImplants(data.active_implants),
		[data.active_implants, t]
	)

	const toggleLocation = (loc: string) => {
		setExpandedLocations((prev) => {
			const next = new Set(prev)
			if (next.has(loc)) next.delete(loc)
			else next.add(loc)
			return next
		})
	}

	const toggleClone = (id: string) => {
		setExpandedClones((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	return (
		<div className="space-y-6">
			{/* Summary info */}
			<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
				{data.home_location && (
					<div>
						<span className="font-medium text-foreground">{t('hrpages.homeStation')}</span>{' '}
						{data.home_location.locationName ??
							t('hrpages.unknownValue1', { value1: data.home_location.location_id })}
					</div>
				)}
				<div>
					<span className="font-medium text-foreground">{t('hrpages.lastCloneJump')}</span>{' '}
					{formatDate(data.last_clone_jump_date)}
				</div>
			</div>

			{/* Active implants */}
			{sortedActiveImplants.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-sm font-semibold">{t('hrpages.activeImplants')}</h3>
					<Card className="bg-card/50">
						<CardContent className="pt-3 pb-3 px-4">
							<ul className="space-y-0.5">
								{sortedActiveImplants.map((implant) => (
									<li key={implant.type_id} className="text-xs text-foreground/80">
										{implant.name ?? implant.type_id}
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				</div>
			)}

			{/* Jump clones - grouped by location */}
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-4">
					<p className="text-sm text-muted-foreground">
						{t('hrpages.jumpCloneCount', { count: data.jump_clones.length })}
						{t('hrpages.across2')} {t('hrpages.location2Count', { count: groups.length })}
					</p>
					{data.jump_clones.length > 0 && (
						<div className="relative w-64">
							<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder={t('hrpages.searchClonesOrLocations')}
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="pl-9 h-9"
							/>
						</div>
					)}
				</div>

				{data.jump_clones.length === 0 ? (
					<p className="text-sm text-muted-foreground">{t('hrpages.noJumpClonesInstalled')}</p>
				) : (
					<div className="space-y-1">
						{groups.map((group) => {
							const isExpanded = expandedLocations.has(group.locationName)
							return (
								<div key={group.locationName}>
									<button
										type="button"
										onClick={() => toggleLocation(group.locationName)}
										className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-muted/50 transition-colors"
									>
										{isExpanded ? (
											<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
										) : (
											<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
										)}
										<span className="font-medium text-sm flex-1 truncate">
											{group.locationName}
										</span>
										<span className="text-xs text-muted-foreground">
											{t('hrpages.cloneCount', { count: group.clones.length })}
										</span>
									</button>

									{isExpanded && (
										<div className="ml-6 space-y-2 py-1">
											{group.clones.map((clone) => (
												<CloneRow
													key={clone.jump_clone_id}
													clone={clone}
													isExpanded={expandedClones.has(clone.jump_clone_id)}
													onToggle={() => toggleClone(clone.jump_clone_id)}
												/>
											))}
										</div>
									)}
								</div>
							)
						})}

						{groups.length === 0 && search && (
							<p className="text-sm text-muted-foreground py-4 text-center">
								{t('hrpages.noClonesMatching')}
								{search}&rdquo;
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	)
}
