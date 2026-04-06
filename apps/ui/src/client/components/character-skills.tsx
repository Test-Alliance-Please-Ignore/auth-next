import { GraduationCap } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formatSkillPoints, toRomanLevel } from '@repo/eve-types'

import { cn } from '../lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface TrainedSkill {
	activeSkillLevel: number
	skillId: number
	skillpointsInSkill: number
	trainedSkillLevel: number
	skillName?: string
	skillGroup?: string
	skillCategory?: string
	rank?: number
	description?: string
}

interface CatalogSkill {
	id: number
	skillId: number
	name: string
	description: string
	rank: number
	primaryAttribute: string | null
	secondaryAttribute: string | null
	published: boolean
	canNotBeTrained: boolean
	groupId: number
	groupName: string
}

/** Merged skill: full catalog entry + character training data */
interface MergedSkill {
	skillId: number
	skillName: string
	rank: number
	groupName: string
	trainedSkillLevel: number
	activeSkillLevel: number
	skillpointsInSkill: number
	isTrained: boolean
}

interface CharacterSkillsProps {
	skills: {
		skills: TrainedSkill[]
		totalSp: number
		unallocatedSp?: number
	}
	allSkills?: CatalogSkill[]
	characterId: string
	showProgress?: boolean
}

// Skill points required per level (multiplied by rank)
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

/** Estimate training time to next level in seconds */
function estimateTrainingTime(trainedLevel: number, sp: number, rank: number): number {
	if (trainedLevel === 5) return 0
	const nextLevel = trainedLevel + 1
	const spForNextLevel = SKILL_POINTS_PER_LEVEL[nextLevel] * rank
	const spRemaining = spForNextLevel - sp
	// Assume ~30 SP/min as a rough average (varies with attributes)
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

type SkillGroup = {
	groupName: string
	totalSP: number
	trainedCount: number
	totalCount: number
	skills: MergedSkill[]
}

/** EVE-style level pips: 5 boxes that fill based on trained level */
function SkillLevelPips({
	level,
	progress,
	className,
}: {
	level: number
	progress?: number
	className?: string
}) {
	return (
		<div className={cn('flex gap-0.5', className)}>
			{[1, 2, 3, 4, 5].map((pip) => {
				const isFilled = pip <= level
				const isPartial = !isFilled && pip === level + 1 && progress !== undefined && progress > 0

				return (
					<div
						key={pip}
						className={cn(
							'h-2.5 w-3 border',
							isFilled
								? 'bg-sky-500 border-sky-400'
								: isPartial
									? 'border-muted-foreground/40 overflow-hidden'
									: 'bg-muted/30 border-muted-foreground/20'
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

export function CharacterSkills({ skills, allSkills, showProgress = false }: CharacterSkillsProps) {
	const [selectedGroup, setSelectedGroup] = useState<string | null>(null)

	const groups = useMemo(() => {
		// Build a map of trained skills by ID (coerce to string for consistent matching)
		const trainedMap = new Map<string, TrainedSkill>()
		for (const skill of skills.skills) {
			trainedMap.set(String(skill.skillId), skill)
		}

		// If we have the full catalog, use it; otherwise fall back to trained-only
		const mergedByGroup = new Map<string, SkillGroup>()

		if (allSkills && allSkills.length > 0) {
			// Full catalog mode: show all skills, trained or not
			const catalogSkillIds = new Set<string>()

			for (const catalogSkill of allSkills) {
				const catalogSkillId = String(catalogSkill.id ?? catalogSkill.skillId)
				catalogSkillIds.add(catalogSkillId)

				const groupName = catalogSkill.groupName || 'Unknown'
				let group = mergedByGroup.get(groupName)
				if (!group) {
					group = { groupName, totalSP: 0, trainedCount: 0, totalCount: 0, skills: [] }
					mergedByGroup.set(groupName, group)
				}

				const trained = trainedMap.get(catalogSkillId)
				const merged: MergedSkill = {
					skillId: catalogSkill.id ?? catalogSkill.skillId,
					skillName: catalogSkill.name,
					rank: catalogSkill.rank,
					groupName,
					trainedSkillLevel: trained?.trainedSkillLevel ?? 0,
					activeSkillLevel: trained?.activeSkillLevel ?? 0,
					skillpointsInSkill: trained?.skillpointsInSkill ?? 0,
					isTrained: !!trained,
				}

				group.skills.push(merged)
				group.totalCount++
				if (trained) {
					group.trainedCount++
					group.totalSP += trained.skillpointsInSkill
				}
			}

			// Include trained skills missing from the catalog so the UI never drops known skills.
			for (const [trainedSkillId, trainedSkill] of trainedMap.entries()) {
				if (catalogSkillIds.has(trainedSkillId)) continue

				const groupName = trainedSkill.skillGroup || trainedSkill.skillCategory || 'Unknown'
				let group = mergedByGroup.get(groupName)
				if (!group) {
					group = { groupName, totalSP: 0, trainedCount: 0, totalCount: 0, skills: [] }
					mergedByGroup.set(groupName, group)
				}

				group.skills.push({
					skillId: Number(trainedSkill.skillId),
					skillName: trainedSkill.skillName || `Unknown Skill (${trainedSkill.skillId})`,
					rank: trainedSkill.rank || 1,
					groupName,
					trainedSkillLevel: trainedSkill.trainedSkillLevel,
					activeSkillLevel: trainedSkill.activeSkillLevel,
					skillpointsInSkill: trainedSkill.skillpointsInSkill,
					isTrained: true,
				})
				group.totalCount++
				group.trainedCount++
				group.totalSP += trainedSkill.skillpointsInSkill
			}
		} else {
			// Fallback: trained skills only
			for (const skill of skills.skills) {
				const groupName = skill.skillGroup || skill.skillCategory || 'Uncategorized'
				let group = mergedByGroup.get(groupName)
				if (!group) {
					group = { groupName, totalSP: 0, trainedCount: 0, totalCount: 0, skills: [] }
					mergedByGroup.set(groupName, group)
				}

				group.skills.push({
					skillId: Number(skill.skillId),
					skillName: skill.skillName || `Skill ${skill.skillId}`,
					rank: skill.rank || 1,
					groupName,
					trainedSkillLevel: skill.trainedSkillLevel,
					activeSkillLevel: skill.activeSkillLevel,
					skillpointsInSkill: skill.skillpointsInSkill,
					isTrained: true,
				})
				group.totalCount++
				group.trainedCount++
				group.totalSP += skill.skillpointsInSkill
			}
		}

		// Sort groups alphabetically (like in-game)
		return Array.from(mergedByGroup.values()).sort((a, b) => a.groupName.localeCompare(b.groupName))
	}, [skills.skills, allSkills])

	const activeGroup = groups.find((g) => g.groupName === selectedGroup)

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<GraduationCap className="h-5 w-5" />
						Skills
					</div>
					<div className="text-sm font-normal text-muted-foreground">
						{formatSkillPoints(skills.totalSp)} Total
						{skills.unallocatedSp != null && skills.unallocatedSp > 0 && (
							<span className="ml-2">• {formatSkillPoints(skills.unallocatedSp)} Unallocated</span>
						)}
					</div>
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				{groups.length === 0 ? (
					<p className="text-sm text-muted-foreground">No skills data available</p>
				) : (
					<>
						{/* Skill Group Grid — column-first fill */}
						<div
							className="grid grid-flow-col gap-1.5"
							style={{
								gridTemplateRows: `repeat(${Math.ceil(groups.length / 3)}, minmax(0, 1fr))`,
							}}
						>
							{groups.map((group) => {
								const pct = group.totalCount > 0 ? (group.trainedCount / group.totalCount) * 100 : 0
								const isSelected = selectedGroup === group.groupName

								return (
									<button
										key={group.groupName}
										type="button"
										onClick={() => setSelectedGroup(isSelected ? null : group.groupName)}
										className={cn(
											'relative flex items-center justify-between rounded px-2.5 py-1.5 text-left transition-colors overflow-hidden',
											'hover:brightness-125',
											isSelected ? 'bg-sky-500/10 text-sky-300' : 'bg-muted/40 text-foreground'
										)}
									>
										{/* Progress bar fill */}
										<div
											className={cn(
												'absolute inset-y-0 left-0 rounded transition-colors',
												isSelected ? 'bg-sky-500/30' : 'bg-muted-foreground/20'
											)}
											style={{ width: `${pct}%` }}
										/>
										<span className="relative text-sm truncate">{group.groupName}</span>
										<span className="relative text-sm tabular-nums text-muted-foreground ml-2 shrink-0">
											{group.totalCount}
										</span>
									</button>
								)
							})}
						</div>

						{/* Selected Group Detail */}
						{activeGroup && (
							<div className="border rounded-md">
								<div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
									<h4 className="text-sm font-semibold">{activeGroup.groupName}</h4>
									<span className="text-xs text-muted-foreground">
										{activeGroup.trainedCount}/{activeGroup.totalCount} trained
										{' • '}
										{formatSkillPoints(activeGroup.totalSP)}
									</span>
								</div>
								<div className="columns-2 gap-x-4 px-4 py-1">
									{activeGroup.skills
										.sort((a, b) => a.skillName.localeCompare(b.skillName))
										.map((skill) => {
											const progress =
												skill.trainedSkillLevel > 0 && skill.trainedSkillLevel < 5
													? calculateSkillProgress(
															skill.trainedSkillLevel,
															skill.skillpointsInSkill,
															skill.rank
														)
													: 0
											const trainingTime =
												skill.trainedSkillLevel < 5
													? estimateTrainingTime(
															skill.trainedSkillLevel,
															skill.skillpointsInSkill,
															skill.rank
														)
													: 0

											return (
												<div
													key={skill.skillId}
													className={cn(
														'flex items-center justify-between py-1 break-inside-avoid',
														!skill.isTrained && 'opacity-40'
													)}
												>
													<div className="flex items-center gap-2 min-w-0">
														<SkillLevelPips
															level={skill.trainedSkillLevel}
															progress={
																showProgress && skill.trainedSkillLevel < 5 ? progress : undefined
															}
														/>
														<span className="text-sm truncate">{skill.skillName}</span>
													</div>
													<div className="text-right shrink-0 ml-1">
														{skill.trainedSkillLevel === 5 ? (
															<span className="text-xs text-green-500">✓</span>
														) : trainingTime > 0 ? (
															<span className="text-xs text-muted-foreground tabular-nums">
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
			</CardContent>
		</Card>
	)
}
