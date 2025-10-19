import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Clock, GraduationCap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

interface SkillQueueEntry {
	queue_position: number
	skill_id: number
	finished_level: number
	start_date?: string
	finish_date?: string
	training_start_sp?: number
	level_start_sp?: number
	level_end_sp?: number
}

interface CharacterSkillQueueProps {
	queue: SkillQueueEntry[]
}

export function CharacterSkillQueue({ queue }: CharacterSkillQueueProps) {
	const sortedQueue = [...queue].sort((a, b) => a.queue_position - b.queue_position)
	const currentlyTraining = sortedQueue.find(
		entry => entry.start_date && new Date(entry.start_date) <= new Date()
	)

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<GraduationCap className="h-5 w-5" />
					Skill Queue
				</CardTitle>
			</CardHeader>
			<CardContent>
				{sortedQueue.length === 0 ? (
					<p className="text-sm text-muted-foreground">No skills in training queue</p>
				) : (
					<div className="space-y-3">
						{sortedQueue.slice(0, 10).map((entry) => {
							const isCurrentlyTraining = entry === currentlyTraining
							const finishTime = entry.finish_date ? new Date(entry.finish_date) : null
							const progress =
								entry.level_start_sp && entry.level_end_sp && entry.training_start_sp
									? ((entry.training_start_sp - entry.level_start_sp) /
											(entry.level_end_sp - entry.level_start_sp)) *
									  100
									: 0

							return (
								<div
									key={entry.queue_position}
									className={`p-3 rounded-lg border ${
										isCurrentlyTraining ? 'border-green-500 bg-green-50' : ''
									}`}
								>
									<div className="flex items-start justify-between">
										<div className="flex-1">
											<div className="flex items-center gap-2">
												<span className="text-sm font-medium">
													Skill #{entry.skill_id}
												</span>
												<span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
													Level {entry.finished_level}
												</span>
												{isCurrentlyTraining && (
													<span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">
														Training
													</span>
												)}
											</div>
											{finishTime && (
												<p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
													<Clock className="h-3 w-3" />
													Completes {formatDistanceToNow(finishTime, { addSuffix: true })}
												</p>
											)}
										</div>
										<span className="text-xs text-muted-foreground">
											#{entry.queue_position + 1}
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
												{Math.round(progress)}% complete
											</p>
										</div>
									)}
								</div>
							)
						})}
						{sortedQueue.length > 10 && (
							<p className="text-xs text-muted-foreground text-center">
								And {sortedQueue.length - 10} more skills in queue...
							</p>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	)
}