import {
	AlertCircle,
	CheckCircle2,
	ClipboardCopy,
	Filter,
	ShoppingCart,
	Star,
	XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import { i18n, useAppTranslation } from '@/i18n'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { LoadingSpinner } from '../../../components/ui/loading'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '../../../components/ui/table'
import { useAuth } from '../../../hooks/useAuth'
import { cn } from '../../../lib/utils'
import { useCharacterSkillLevels, usePlanSkills } from '../hooks'
import { calculateCharacterProgress } from '../utils/readiness'

import type { CharacterSkillProgress } from '../types'

interface ProgressCheckerProps {
	planId: string
	planName?: string
	initialCharacterId?: string
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V']

/** Build an EVE-importable skill list at the selected plan target level. */
function buildSkillText(
	skills: CharacterSkillProgress[],
	mode: 'required' | 'recommended',
	includeAll: boolean
): string {
	const lines: string[] = []
	const selectedSkills = includeAll
		? skills
		: skills.filter((skill) =>
				mode === 'required' ? !skill.meetsRequired : !skill.meetsRecommended
			)

	for (const skill of selectedSkills) {
		const targetLevel = mode === 'required' ? skill.requiredLevel : skill.recommendedLevel
		const startLevel = includeAll ? 1 : skill.currentLevel + 1
		for (let lvl = startLevel; lvl <= targetLevel; lvl++) {
			lines.push(`${skill.skillName} ${ROMAN[lvl]}`)
		}
	}
	return lines.join('\n')
}

async function copyMissingSkillbooks(
	skills: CharacterSkillProgress[],
	characterSkillLevels: Record<string, number>
) {
	const missing = skills.filter((s) => !(s.skillId in characterSkillLevels))
	if (missing.length === 0) return
	const text = missing.map((s) => s.skillName).join('\n')
	const { success, error } = await import('../../../lib/toast')
	try {
		await navigator.clipboard.writeText(text)
		success(i18n.t('skillPlans.copiedSkillbooks', { count: missing.length }))
	} catch {
		error(i18n.t('skillPlans.failedToCopyToClipboard'))
	}
}

async function copyMissingSkills(
	skills: CharacterSkillProgress[],
	mode: 'required' | 'recommended'
) {
	const missing = skills.filter((skill) =>
		mode === 'required' ? !skill.meetsRequired : !skill.meetsRecommended
	)
	const text = buildSkillText(missing, mode, false)
	if (!text) return
	const { success, error } = await import('../../../lib/toast')
	try {
		await navigator.clipboard.writeText(text)
		success(i18n.t('skillPlans.copiedValue1MissingSkillsToClipboard', { value1: missing.length }))
	} catch {
		error(i18n.t('skillPlans.failedToCopyToClipboard'))
	}
}

async function copyAllSkills(skills: CharacterSkillProgress[], mode: 'required' | 'recommended') {
	const text = buildSkillText(skills, mode, true)
	if (!text) return
	const { success, error } = await import('../../../lib/toast')
	try {
		await navigator.clipboard.writeText(text)
		success(i18n.t('skillPlans.copiedSkills', { count: skills.length }))
	} catch {
		error(i18n.t('skillPlans.failedToCopyToClipboard'))
	}
}

export function ProgressChecker({ planId, planName, initialCharacterId }: ProgressCheckerProps) {
	const { t } = useAppTranslation()

	const { user } = useAuth()
	const selectedCharacterId = initialCharacterId || user?.mainCharacterId || ''
	const [skillFilter, setSkillFilter] = useState<'all' | 'needs-training' | 'missing-required'>(
		'all'
	)

	const { data: planSkills, isLoading: isPlanSkillsLoading } = usePlanSkills(planId)
	const { data: selectedCharacterSkills, isLoading: isCharacterSkillsLoading } =
		useCharacterSkillLevels(selectedCharacterId || undefined)

	if (!user) {
		return (
			<Card>
				<CardContent className="py-8 text-center text-muted-foreground">
					{t('skillPlans.pleaseLogInToCheckCharacterProgress')}
				</CardContent>
			</Card>
		)
	}

	const selectedCharacter = user.characters.find((c) => c.characterId === selectedCharacterId)
	const progress = useMemo(() => {
		if (!selectedCharacter || !planSkills || !selectedCharacterSkills) {
			return undefined
		}

		return calculateCharacterProgress({
			planId,
			planName: planName || t('skillPlans.skillPlan'),
			characterId: selectedCharacter.characterId,
			characterName: selectedCharacter.characterName,
			planSkills,
			characterSkillLevels: selectedCharacterSkills.levels,
		})
	}, [planId, planName, planSkills, selectedCharacter, selectedCharacterSkills, t])
	const isLoading = isPlanSkillsLoading || isCharacterSkillsLoading

	return (
		<div className="space-y-4">
			{/* Progress display */}
			{isLoading ? (
				<Card>
					<CardContent className="py-8 flex items-center justify-center">
						<LoadingSpinner />
						<span className="ml-2">{t('skillPlans.checkingCharacterSkills')}</span>
					</CardContent>
				</Card>
			) : progress ? (
				<>
					{/* Overall progress */}
					<Card>
						<CardHeader>
							<CardTitle>{t('skillPlans.overallProgress')}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-3">
								<div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
									{t('skillPlans.progressTargets')}
								</div>
								<div className="grid gap-2 md:grid-cols-2">
									<div className="rounded-md border border-success/30 bg-success/5 px-3 py-2">
										<div className="flex items-center justify-between gap-2">
											<span className="text-sm font-medium text-success">
												{t('skillPlans.requiredSkills')}
											</span>
											<span className="text-sm font-bold text-success">
												{progress.completedRequired || 0} / {progress.totalSkills || 0}
											</span>
										</div>
										<div className="mt-2 flex flex-wrap gap-1">
											{(progress.completedRequired || 0) < (progress.totalSkills || 0) && (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-2 text-xs gap-1"
													onClick={() => copyMissingSkills(progress.skills || [], 'required')}
													title={t('skillPlans.copyMissingRequiredSkillsForEveImport')}
												>
													<ClipboardCopy className="h-3 w-3" />
													{t('skillPlans.copyMissingRequired')}
												</Button>
											)}
											{(progress.skills || []).length > 0 && (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-2 text-xs gap-1"
													onClick={() => copyAllSkills(progress.skills || [], 'required')}
													title={t('skillPlans.copyAllRequiredSkillsForEveImport')}
												>
													<ClipboardCopy className="h-3 w-3" />
													{t('skillPlans.copyAllRequired')}
												</Button>
											)}
										</div>
									</div>
									<div className="rounded-md border border-amber-300/30 bg-amber-400/5 px-3 py-2">
										<div className="flex items-center justify-between gap-2">
											<span className="text-sm font-medium text-amber-300">
												{t('skillPlans.recommendedSkills')}
											</span>
											<span className="text-sm font-bold text-amber-300">
												{progress.completedRecommendedUpgrades || 0} /{' '}
												{progress.totalRecommendedUpgrades || 0}
											</span>
										</div>
										<div className="mt-2 flex flex-wrap gap-1">
											{(progress.completedRecommendedUpgrades || 0) <
												(progress.totalRecommendedUpgrades || 0) && (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-2 text-xs gap-1"
													onClick={() => copyMissingSkills(progress.skills || [], 'recommended')}
													title={t('skillPlans.copyMissingRecommendedSkillsForEveImport')}
												>
													<ClipboardCopy className="h-3 w-3" />
													{t('skillPlans.copyMissingRecommended')}
												</Button>
											)}
											{(progress.skills || []).length > 0 && (
												<Button
													variant="ghost"
													size="sm"
													className="h-7 px-2 text-xs gap-1"
													onClick={() => copyAllSkills(progress.skills || [], 'recommended')}
													title={t('skillPlans.copyAllRecommendedSkillsForEveImport')}
												>
													<ClipboardCopy className="h-3 w-3" />
													{t('skillPlans.copyAllRecommended')}
												</Button>
											)}
										</div>
									</div>
								</div>
								<div className="relative h-2 w-full overflow-hidden rounded-full bg-destructive/25">
									{(() => {
										const requiredCount = progress.totalSkills || 0
										const recommendedUpgradeCount = progress.totalRecommendedUpgrades || 0
										const totalStages = requiredCount + recommendedUpgradeCount
										const requiredSegmentMax =
											totalStages > 0 ? (requiredCount / totalStages) * 100 : 100
										const recommendedSegmentMax = Math.max(0, 100 - requiredSegmentMax)
										const greenWidth =
											requiredCount > 0
												? requiredSegmentMax *
													Math.max(
														0,
														Math.min(1, (progress.completedRequired || 0) / requiredCount)
													)
												: requiredSegmentMax
										const goldWidth =
											recommendedUpgradeCount > 0
												? recommendedSegmentMax *
													Math.max(
														0,
														Math.min(
															1,
															(progress.completedRecommendedUpgrades || 0) / recommendedUpgradeCount
														)
													)
												: 0

										return (
											<>
												<div
													className="absolute inset-y-0 left-0 bg-success transition-all"
													style={{ width: `${greenWidth}%` }}
												/>
												<div
													className="absolute inset-y-0 bg-amber-400 transition-all"
													style={{
														left: `${requiredSegmentMax}%`,
														width: `${goldWidth}%`,
													}}
												/>
											</>
										)
									})()}
								</div>
								<div className="flex justify-between text-xs text-muted-foreground">
									<p>
										{(progress.percentageRequired || 0).toFixed(1)}
										{t('skillPlans.required3')}
									</p>
									<p>
										{(progress.percentageRecommendedUpgrades || 0).toFixed(1)}
										{t('skillPlans.recommended3')}
									</p>
								</div>
							</div>

							{/* Status badge + skillbooks */}
							<div className="flex items-center justify-between pt-2">
								<div className="flex items-center gap-2">
									{(progress.percentageRequired || 0) === 100 ? (
										<Badge variant="default" className="flex items-center gap-1">
											<CheckCircle2 className="h-3 w-3" />
											{t('skillPlans.readyForPlan')}
										</Badge>
									) : (progress.percentageRequired || 0) >= 75 ? (
										<Badge variant="secondary" className="flex items-center gap-1">
											<AlertCircle className="h-3 w-3" />
											{t('skillPlans.almostReady')}
										</Badge>
									) : (
										<Badge variant="destructive" className="flex items-center gap-1">
											<XCircle className="h-3 w-3" />
											{t('skillPlans.trainingNeeded')}
										</Badge>
									)}
								</div>
								{(() => {
									const missingCount = (progress.skills || []).filter(
										(s) => !(s.skillId in (selectedCharacterSkills?.levels ?? {}))
									).length
									return missingCount > 0 ? (
										<Button
											variant="ghost"
											size="sm"
											className="h-7 px-2 text-xs gap-1"
											onClick={() =>
												copyMissingSkillbooks(
													progress.skills || [],
													selectedCharacterSkills?.levels ?? {}
												)
											}
											title={t('skillPlans.copyMissingSkillbooksForEveMultiBuy')}
										>
											<ShoppingCart className="h-3 w-3" />
											{t('skillPlans.copyMissingSkillbooks')}
											{missingCount})
										</Button>
									) : null
								})()}
							</div>
						</CardContent>
					</Card>

					{/* Skills breakdown */}
					<Card>
						<CardHeader>
							<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
								<CardTitle>{t('skillPlans.skillsBreakdown')}</CardTitle>
								<div className="inline-flex rounded-lg border divide-x">
									<Button
										variant={skillFilter === 'all' ? 'secondary' : 'ghost'}
										size="sm"
										className="text-xs h-8 rounded-none rounded-l-md border-0"
										onClick={() => setSkillFilter('all')}
									>
										{t('skillPlans.all')}
										{progress.skills?.length || 0})
									</Button>
									<Button
										variant={skillFilter === 'missing-required' ? 'secondary' : 'ghost'}
										size="sm"
										className="text-xs h-8 rounded-none border-0"
										onClick={() => setSkillFilter('missing-required')}
									>
										<XCircle className="h-3 w-3 mr-1" />
										{t('skillPlans.required4')}
										{progress.skills?.filter((s) => !s.meetsRequired).length || 0})
									</Button>
									<Button
										variant={skillFilter === 'needs-training' ? 'secondary' : 'ghost'}
										size="sm"
										className="text-xs h-8 rounded-none rounded-r-md border-0"
										onClick={() => setSkillFilter('needs-training')}
									>
										<Filter className="h-3 w-3 mr-1" />
										{t('skillPlans.training')}
										{progress.skills?.filter((s) => !s.meetsRecommended).length || 0})
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('skillPlans.skill')}</TableHead>
										<TableHead className="text-center">{t('skillPlans.current')}</TableHead>
										<TableHead className="text-center">{t('skillPlans.required')}</TableHead>
										<TableHead className="text-center">{t('skillPlans.recommended')}</TableHead>
										<TableHead>{t('skillPlans.status')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(() => {
										const allSkills = progress.skills || []
										let filteredSkills = allSkills

										if (skillFilter === 'needs-training') {
											filteredSkills = allSkills.filter((skill) => !skill.meetsRecommended)
										} else if (skillFilter === 'missing-required') {
											filteredSkills = allSkills.filter((skill) => !skill.meetsRequired)
										}

										if (filteredSkills.length === 0) {
											let message = ''
											if (skillFilter === 'needs-training') {
												message = t('skillPlans.fullyTrainedMessage')
											} else if (skillFilter === 'missing-required') {
												message = t('skillPlans.requiredTrainedMessage')
											}

											if (message) {
												return (
													<TableRow>
														<TableCell
															colSpan={5}
															className="text-center py-8 text-muted-foreground"
														>
															{message}
														</TableCell>
													</TableRow>
												)
											}
										}

										return filteredSkills.map((skill) => (
											<TableRow
												key={skill.skillId}
												className={cn(
													skill.meetsRecommended && 'bg-amber-400/10',
													!skill.meetsRecommended && skill.meetsRequired && 'bg-success/10',
													!skill.meetsRequired && 'bg-red-500/10'
												)}
											>
												<TableCell className="font-medium">
													{skill.skillName || t('skillPlans.unknownSkill')}
												</TableCell>
												<TableCell
													className={cn(
														'text-center',
														skill.meetsRecommended
															? skill.recommendedLevel > skill.requiredLevel
																? 'font-bold text-amber-300'
																: 'text-success'
															: skill.meetsRequired
																? 'text-success'
																: 'font-bold text-destructive'
													)}
												>
													{(skill.currentLevel || 0) > 0 ? skill.currentLevel : '-'}
												</TableCell>
												<TableCell className="text-center font-bold text-success">
													{skill.requiredLevel || 0}
												</TableCell>
												<TableCell
													className={cn(
														'text-center',
														skill.recommendedLevel > skill.requiredLevel
															? 'font-bold text-amber-300'
															: 'text-success'
													)}
												>
													{skill.recommendedLevel || 0}
												</TableCell>
												<TableCell>
													{skill.meetsRecommended ? (
														<div className="flex items-center gap-1 text-amber-300">
															<Star className="h-4 w-4 fill-current" />
															<span className="text-xs">{t('skillPlans.fullyTrained2')}</span>
														</div>
													) : skill.meetsRequired ? (
														<div className="flex items-center gap-1 text-success">
															<CheckCircle2 className="h-4 w-4" />
															<span className="text-xs">{t('skillPlans.meetsMinimum')}</span>
														</div>
													) : (
														<div className="flex items-center gap-1 text-destructive">
															<XCircle className="h-4 w-4" />
															<span className="text-xs">
																{skill.currentLevel === 0
																	? t('skillPlans.notTrained')
																	: t('skillPlans.needsTraining2')}
															</span>
														</div>
													)}
												</TableCell>
											</TableRow>
										))
									})()}
								</TableBody>
							</Table>

							{(!progress.skills || progress.skills.length === 0) && (
								<div className="text-center py-8 text-muted-foreground">
									{t('skillPlans.thisPlanHasNoSkillsAddedYet')}
								</div>
							)}
						</CardContent>
					</Card>
				</>
			) : selectedCharacter && !selectedCharacter.hasValidToken ? (
				<Card>
					<CardContent className="py-8 text-center">
						<p className="text-muted-foreground mb-2">
							{t('skillPlans.thisCharacterSEveTokenHasExpired')}
						</p>
						<p className="text-sm text-muted-foreground">
							{t('skillPlans.pleaseReAuthenticateWithEveOnlineToCheckSkillProgress')}
						</p>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardContent className="py-8 text-center text-muted-foreground">
						{t('skillPlans.selectACharacterToCheckProgress')}
					</CardContent>
				</Card>
			)}
		</div>
	)
}
