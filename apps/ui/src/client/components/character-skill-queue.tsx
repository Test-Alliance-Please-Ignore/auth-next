import { Clock, GraduationCap } from 'lucide-react'

import { formatSkillWithLevel } from '@repo/eve-types'

import { useAppTranslation } from '@/i18n'
import { formatRelativeTime as formatDistanceToNow } from '@/lib/date-utils'

import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

// Extended queue entry with enriched data from backend
interface EnrichedSkillQueueEntry {
	queuePosition: number
	skillId: number
	finishedLevel: number
	startDate?: string
	finishDate?: string
	levelStartSp?: number
	levelEndSp?: number
	trainingStartSp?: number
	// Enriched fields from backend
	skillName?: string
	skillGroup?: string
	skillCategory?: string
}

interface CharacterSkillQueueProps {
	queue: EnrichedSkillQueueEntry[]
}

export function CharacterSkillQueue({ queue }: CharacterSkillQueueProps) {
	const { t } = useAppTranslation()

	const sortedQueue = [...queue].sort((a, b) => a.queuePosition - b.queuePosition)
	const currentlyTraining = sortedQueue.find(
		(entry) => entry.startDate && new Date(entry.startDate) <= new Date()
	)

	// Skills now come enriched from the backend, no need for separate metadata fetch

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<GraduationCap className="h-5 w-5" />
					{t('characterpages.skillQueue')}
				</CardTitle>
			</CardHeader>
			<CardContent>
				{sortedQueue.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t('characterpages.noSkillsInTrainingQueue')}
					</p>
				) : (
					<div className="space-y-3">
						{sortedQueue.slice(0, 10).map((entry) => {
							const isCurrentlyTraining = entry === currentlyTraining
							const finishTime = entry.finishDate ? new Date(entry.finishDate) : null
							const progress =
								entry.levelStartSp && entry.levelEndSp && entry.trainingStartSp
									? ((entry.trainingStartSp - entry.levelStartSp) /
											(entry.levelEndSp - entry.levelStartSp)) *
										100
									: 0

							// Use skill name directly from enriched data
							const skillName =
								entry.skillName || t('characterpages.unknownSkillValue1', { value1: entry.skillId })
							const skillDisplay = formatSkillWithLevel(skillName, entry.finishedLevel)

							return (
								<div
									key={entry.queuePosition}
									className={`p-3 rounded-lg border ${
										isCurrentlyTraining ? 'border-green-500 bg-green-50' : ''
									}`}
								>
									<div className="flex items-start justify-between">
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<span className="text-sm font-medium">{skillDisplay}</span>
												{isCurrentlyTraining && (
													<span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
														{t('characterpages.training')}
													</span>
												)}
											</div>
											{finishTime && (
												<p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
													<Clock className="h-3 w-3" />
													{t('characterpages.completes')}
													{formatDistanceToNow(finishTime, { addSuffix: true })}
												</p>
											)}
										</div>
										<span className="text-xs text-muted-foreground">
											#{entry.queuePosition + 1}
										</span>
									</div>
									{isCurrentlyTraining && progress > 0 && (
										<div className="mt-2">
											<div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
												<div
													className="h-full bg-green-500 transition-all"
													style={{ width: `${Math.min(100, progress)}%` }}
												/>
											</div>
											<p className="text-xs text-muted-foreground mt-1">
												{Math.round(progress)}
												{t('characterpages.complete')}
											</p>
										</div>
									)}
								</div>
							)
						})}
						{sortedQueue.length > 10 && (
							<p className="text-xs text-muted-foreground text-center">
								{t('characterpages.and')}
								{sortedQueue.length - 10}
								{t('characterpages.moreSkillsInQueue')}
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
