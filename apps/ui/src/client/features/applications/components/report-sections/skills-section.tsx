/**
 * Skills Section - Grouped skill view matching /character/:id format
 *
 * Shows skills grouped by category with expandable groups.
 * All skills (including untrained) are shown when the full catalog is loaded.
 * Skill queue is displayed below the grouped view.
 */

import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Clock } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { apiClient } from '@/lib/api'
import { cn } from '@/lib/utils'

// ============================================================================
// Types
// ============================================================================

interface ProcessedSkill {
	skillId: string
	skillName?: string
	activeLevel: number
	trainedLevel: number
	skillpointsInSkill: number
}

interface ProcessedSkillQueueEntry {
	skillId: string
	skillName?: string
	finishedLevel: number
	queuePosition: number
	startDate?: string
	finishDate?: string
}

interface ProcessedSkillsData {
	totalSp: number
	unallocatedSp?: number
	skillCount: number
	skills: ProcessedSkill[]
	skillQueue: ProcessedSkillQueueEntry[]
}

interface CatalogSkill {
	id: number
	skillId: number
	name: string
	rank: number
	groupName: string
	canNotBeTrained?: boolean
}

interface MergedSkill {
	skillId: string
	skillName: string
	rank: number
	groupName: string
	trainedLevel: number
	activeLevel: number
	skillpointsInSkill: number
	isTrained: boolean
}

interface SkillGroup {
	groupName: string
	totalSP: number
	trainedCount: number
	totalCount: number
	skills: MergedSkill[]
}

// ============================================================================
// Constants & Helpers
// ============================================================================

const SKILL_POINTS_PER_LEVEL = [0, 250, 1414, 8000, 45255, 256000]

function calculateSkillProgress(trainedLevel: number, sp: number, rank: number): number {
	if (trainedLevel === 5) return 100
	const nextLevel = trainedLevel + 1
	const spForCurrentLevel = SKILL_POINTS_PER_LEVEL[trainedLevel] * rank
	const spForNextLevel = SKILL_POINTS_PER_LEVEL[nextLevel] * rank
	const spNeeded = spForNextLevel - spForCurrentLevel
	const spProgress = sp - spForCurrentLevel
	return Math.min(100, Math.max(0, (spProgress / spNeeded) * 100))
}

function estimateTrainingTime(trainedLevel: number, sp: number, rank: number): number {
	if (trainedLevel === 5) return 0
	const nextLevel = trainedLevel + 1
	const spForNextLevel = SKILL_POINTS_PER_LEVEL[nextLevel] * rank
	const spRemaining = spForNextLevel - sp
	return Math.max(0, Math.round((spRemaining / 30) * 60))
}

function formatTrainingTime(seconds: number): string {
	if (seconds <= 0) return ''
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const mins = Math.floor((seconds % 3600) / 60)
	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${mins}m`
	return `${mins}m`
}

function formatSp(sp: number): string {
	if (sp >= 1_000_000) return `${(sp / 1_000_000).toFixed(1)}M`
	if (sp >= 1_000) return `${(sp / 1_000).toFixed(1)}K`
	return sp.toString()
}

// ============================================================================
// Sub-components
// ============================================================================

function SkillLevelPips({ level, progress }: { level: number; progress?: number }) {
	return (
		<div className="flex gap-0.5">
			{[1, 2, 3, 4, 5].map((pip) => {
				const isFilled = pip <= level
				const isPartial =
					!isFilled && pip === level + 1 && progress !== undefined && progress > 0

				return (
					<div
						key={pip}
						className={cn(
							'h-2.5 w-3 border',
							isFilled
								? 'bg-sky-500 border-sky-400'
								: isPartial
									? 'border-muted-foreground/40 overflow-hidden'
									: 'bg-muted/30 border-muted-foreground/20',
						)}
					>
						{isPartial && (
							<div className="h-full bg-sky-500/60" style={{ width: `${progress}%` }} />
						)}
					</div>
				)
			})}
		</div>
	)
}

// ============================================================================
// Hooks
// ============================================================================

function useSkillCatalog() {
	return useQuery<CatalogSkill[]>({
		queryKey: ['skill-catalog'],
		queryFn: async () => {
			const skills = await apiClient.get<any[]>('/skills')
			return skills.map((s) => ({
				id: s.id || s.skillId,
				skillId: s.id || s.skillId,
				name: s.name,
				rank: s.rank,
				groupName: s.groupName || 'Unknown',
				canNotBeTrained: s.canNotBeTrained,
			}))
		},
		staleTime: 1000 * 60 * 30,
		gcTime: 1000 * 60 * 60,
	})
}

// ============================================================================
// Main Component
// ============================================================================

export function SkillsSection({ data }: { data: ProcessedSkillsData }) {
	const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
	const { data: catalog, isLoading: catalogLoading } = useSkillCatalog()

	const groups = useMemo(() => {
		const trainedMap = new Map<string, ProcessedSkill>()
		for (const skill of data.skills) {
			trainedMap.set(String(skill.skillId), skill)
		}

		const mergedByGroup = new Map<string, SkillGroup>()

		if (catalog && catalog.length > 0) {
			for (const catalogSkill of catalog) {
				if (catalogSkill.canNotBeTrained) continue

				const groupName = catalogSkill.groupName
				let group = mergedByGroup.get(groupName)
				if (!group) {
					group = { groupName, totalSP: 0, trainedCount: 0, totalCount: 0, skills: [] }
					mergedByGroup.set(groupName, group)
				}

				const trained = trainedMap.get(String(catalogSkill.id ?? catalogSkill.skillId))
				group.skills.push({
					skillId: String(catalogSkill.id ?? catalogSkill.skillId),
					skillName: catalogSkill.name,
					rank: catalogSkill.rank,
					groupName,
					trainedLevel: trained?.trainedLevel ?? 0,
					activeLevel: trained?.activeLevel ?? 0,
					skillpointsInSkill: trained?.skillpointsInSkill ?? 0,
					isTrained: !!trained,
				})

				group.totalCount++
				if (trained) {
					group.trainedCount++
					group.totalSP += trained.skillpointsInSkill
				}
			}
		} else {
			// Fallback: trained skills only
			for (const skill of data.skills) {
				const groupName = 'Trained Skills'
				let group = mergedByGroup.get(groupName)
				if (!group) {
					group = { groupName, totalSP: 0, trainedCount: 0, totalCount: 0, skills: [] }
					mergedByGroup.set(groupName, group)
				}

				group.skills.push({
					skillId: skill.skillId,
					skillName: skill.skillName || `Skill ${skill.skillId}`,
					rank: 1,
					groupName,
					trainedLevel: skill.trainedLevel,
					activeLevel: skill.activeLevel,
					skillpointsInSkill: skill.skillpointsInSkill,
					isTrained: true,
				})
				group.totalCount++
				group.trainedCount++
				group.totalSP += skill.skillpointsInSkill
			}
		}

		return Array.from(mergedByGroup.values()).sort((a, b) =>
			a.groupName.localeCompare(b.groupName),
		)
	}, [data.skills, catalog])

	const activeGroup = groups.find((g) => g.groupName === selectedGroup)
	const activeQueue = data.skillQueue.filter((q) => q.finishDate)

	return (
		<div className="space-y-6">
			{/* Summary Row */}
			<div className="grid gap-4 sm:grid-cols-3">
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">Total SP</p>
						<p className="text-lg font-bold text-foreground">{formatSp(data.totalSp)}</p>
					</CardContent>
				</Card>
				<Card variant="flat">
					<CardContent className="py-3">
						<p className="text-xs text-muted-foreground">Skills Trained</p>
						<p className="text-lg font-bold text-foreground">{data.skillCount}</p>
					</CardContent>
				</Card>
				{data.unallocatedSp != null && (
					<Card variant="flat">
						<CardContent className="py-3">
							<p className="text-xs text-muted-foreground">Unallocated SP</p>
							<p className="text-lg font-bold text-foreground">
								{formatSp(data.unallocatedSp)}
							</p>
						</CardContent>
					</Card>
				)}
			</div>

			{/* Grouped Skills */}
			{catalogLoading ? (
				<div className="space-y-2">
					<Skeleton className="h-6 w-32" />
					<Skeleton className="h-48 w-full" />
				</div>
			) : groups.length === 0 ? (
				<p className="text-sm text-muted-foreground">No skills data available</p>
			) : (
				<>
					{/* Skill Group Grid — column-first fill, matching character detail */}
					<div
						className="grid grid-flow-col gap-1.5"
						style={{
							gridTemplateRows: `repeat(${Math.ceil(groups.length / 3)}, minmax(0, 1fr))`,
						}}
					>
						{groups.map((group) => {
							const pct =
								group.totalCount > 0
									? (group.trainedCount / group.totalCount) * 100
									: 0
							const isSelected = selectedGroup === group.groupName

							return (
								<button
									key={group.groupName}
									type="button"
									onClick={() =>
										setSelectedGroup(isSelected ? null : group.groupName)
									}
									className={cn(
										'relative flex items-center justify-between rounded px-2.5 py-1.5 text-left transition-colors overflow-hidden',
										'hover:brightness-125',
										isSelected
											? 'bg-sky-500/10 text-sky-300'
											: 'bg-muted/40 text-foreground',
									)}
								>
									<div
										className={cn(
											'absolute inset-y-0 left-0 rounded transition-colors',
											isSelected ? 'bg-sky-500/30' : 'bg-muted-foreground/20',
										)}
										style={{ width: `${pct}%` }}
									/>
									<span className="relative text-sm truncate">
										{group.groupName}
									</span>
									<span className="relative ml-2 shrink-0 text-sm tabular-nums text-muted-foreground">
										{group.trainedCount}/{group.totalCount}
									</span>
								</button>
							)
						})}
					</div>

					{/* Expanded Group Detail */}
					{activeGroup && (
						<div className="rounded-md border">
							<div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
								<h4 className="text-sm font-semibold">{activeGroup.groupName}</h4>
								<span className="text-xs text-muted-foreground">
									{activeGroup.trainedCount}/{activeGroup.totalCount} trained
									{' • '}
									{formatSp(activeGroup.totalSP)} SP
								</span>
							</div>
							<div className="columns-2 gap-x-4 px-4 py-1">
								{activeGroup.skills
									.sort((a, b) => a.skillName.localeCompare(b.skillName))
									.map((skill) => {
										const progress =
											skill.trainedLevel > 0 && skill.trainedLevel < 5
												? calculateSkillProgress(
														skill.trainedLevel,
														skill.skillpointsInSkill,
														skill.rank,
													)
												: 0
										const trainingTime =
											skill.trainedLevel < 5
												? estimateTrainingTime(
														skill.trainedLevel,
														skill.skillpointsInSkill,
														skill.rank,
													)
												: 0

										return (
											<div
												key={skill.skillId}
												className={cn(
													'flex items-center justify-between break-inside-avoid py-1',
													!skill.isTrained && 'opacity-40',
												)}
											>
												<div className="flex min-w-0 items-center gap-2">
													<SkillLevelPips
														level={skill.trainedLevel}
														progress={
															skill.trainedLevel < 5 ? progress : undefined
														}
													/>
													<span className="truncate text-sm">
														{skill.skillName}
													</span>
												</div>
												<div className="ml-1 shrink-0 text-right">
													{skill.trainedLevel === 5 ? (
														<span className="text-xs text-green-500">✓</span>
													) : trainingTime > 0 ? (
														<span className="text-xs tabular-nums text-muted-foreground">
															{formatTrainingTime(trainingTime)}
														</span>
													) : null}
												</div>
											</div>
										)
									})}
							</div>
						</div>
					)}
				</>
			)}

			{/* Skill Queue — below grouped skills */}
			{activeQueue.length > 0 && (
				<div className="space-y-3">
					<h4 className="text-sm font-semibold text-foreground">
						Skill Queue ({activeQueue.length})
					</h4>
					<div className="space-y-2">
						{activeQueue.map((entry) => {
							const isCurrentlyTraining =
								entry.startDate && new Date(entry.startDate) <= new Date()
							const finishTime = entry.finishDate
								? new Date(entry.finishDate)
								: null

							return (
								<div
									key={entry.queuePosition}
									className={cn(
										'flex items-start justify-between rounded-lg border p-3',
										isCurrentlyTraining && 'border-green-500/50 bg-green-500/5',
									)}
								>
									<div className="flex-1">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium">
												{entry.skillName || entry.skillId}
											</span>
											<Badge variant="outline" className="text-xs">
												Level {entry.finishedLevel}
											</Badge>
											{isCurrentlyTraining && (
												<Badge
													variant="success"
													className="text-xs"
												>
													Training
												</Badge>
											)}
										</div>
										{finishTime && (
											<p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
												<Clock className="h-3 w-3" />
												Completes{' '}
												{formatDistanceToNow(finishTime, {
													addSuffix: true,
												})}
											</p>
										)}
									</div>
									<span className="text-xs text-muted-foreground">
										#{entry.queuePosition + 1}
									</span>
								</div>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}
