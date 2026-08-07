import { CheckCircle2, Star, XCircle } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { CharacterMasteryCardProps, MasteryStatus } from '../types'

export function CharacterMasteryCard({
	characterId,
	characterName,
	progress,
	isLoading,
	error,
	onClick,
}: CharacterMasteryCardProps) {
	// Determine mastery status based on progress
	const getMasteryStatus = (): MasteryStatus => {
		if (!progress) return 'insufficient'

		if (progress.percentageRecommended >= 100) {
			return 'fully_trained'
		} else if (progress.percentageRequired >= 100) {
			return 'meets_minimum'
		}
		return 'insufficient'
	}

	const masteryStatus = getMasteryStatus()

	// Get status box styling and content based on mastery status
	const getStatusDisplay = () => {
		// Get the progress percentage for visual display
		const progressPercent = progress?.percentageRequired || 0

		switch (masteryStatus) {
			case 'fully_trained':
				return {
					boxClass: 'border-amber-300 text-amber-300',
					bgClass: 'bg-amber-400/20',
					icon: <Star className="h-5 w-5 fill-current" />,
					text: 'Fully Trained',
					progressPercent: 100,
				}
			case 'meets_minimum':
				return {
					boxClass: 'border-success text-success',
					bgClass: 'bg-success/20',
					icon: <CheckCircle2 className="h-5 w-5" />,
					text: 'Meets Required',
					progressPercent: 100,
				}
			case 'insufficient':
			default: {
				return {
					boxClass: 'border-destructive text-destructive',
					bgClass: 'bg-destructive/20',
					icon: <XCircle className="h-5 w-5" />,
					text: 'Needs Training',
					progressPercent,
				}
			}
		}
	}

	const statusDisplay = getStatusDisplay()

	if (isLoading) {
		return (
			<Card variant="flat" className="p-4 border-2 border-primary/30">
				<div className="flex flex-col items-center gap-3">
					{/* Animated loading spinner */}
					<div className="relative h-16 w-16">
						<div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
						<div className="absolute inset-2 rounded-full bg-primary/50 animate-pulse" />
						<div className="absolute inset-4 rounded-full bg-primary animate-spin border-4 border-transparent border-t-primary-foreground" />
					</div>

					{/* Skeleton elements with staggered animation */}
					<div
						className="h-5 w-32 bg-primary/40 rounded animate-pulse"
						style={{ animationDelay: '0.1s' }}
					/>
					<div
						className="h-10 w-40 bg-primary/40 rounded-md animate-pulse"
						style={{ animationDelay: '0.2s' }}
					/>
					<div
						className="h-4 w-24 bg-primary/30 rounded animate-pulse"
						style={{ animationDelay: '0.3s' }}
					/>
					<div
						className="h-4 w-28 bg-primary/30 rounded animate-pulse"
						style={{ animationDelay: '0.4s' }}
					/>

					{/* Loading text with fade animation */}
					<div className="text-sm font-medium text-primary mt-2 animate-pulse">
						Loading progress...
					</div>
				</div>
			</Card>
		)
	}

	if (error) {
		return (
			<Card variant="flat" className="p-4">
				<div className="flex flex-col items-center gap-3">
					<MemberAvatar characterId={characterId} size="lg" />
					<h4 className="font-medium text-sm">{characterName}</h4>
					<div className="text-sm text-destructive">Failed to load progress</div>
				</div>
			</Card>
		)
	}

	return (
		<Card
			variant={onClick ? 'interactive' : 'flat'}
			className={cn('p-4 transition-all', onClick && 'cursor-pointer hover:scale-[1.02]')}
			onClick={onClick}
		>
			<div className="flex flex-col items-center gap-3">
				{/* Character Avatar */}
				<MemberAvatar characterId={characterId} characterName={characterName} size="lg" />

				{/* Character Name */}
				<h4 className="font-medium text-sm text-center">{characterName}</h4>

				{/* Status Box with Progress Fill */}
				<div
					className={cn(
						'relative overflow-hidden rounded-md border',
						statusDisplay.boxClass,
						'min-w-[160px]'
					)}
				>
					{/* Background for contrast */}
					<div className="absolute inset-0 bg-background opacity-50" />

					{/* Progress fill */}
					<div
						className={cn(
							'absolute inset-y-0 left-0 transition-all duration-500 ease-out',
							statusDisplay.bgClass
						)}
						style={{
							width: `${statusDisplay.progressPercent}%`,
						}}
					/>

					{/* Content */}
					<div className="relative flex items-center justify-center gap-2 px-3 py-2">
						{statusDisplay.icon}
						<span className="text-sm font-medium">{statusDisplay.text}</span>
					</div>
				</div>

				{/* Progress Details */}
				{progress && (
					<div className="text-center space-y-1">
						<div className="text-sm text-muted-foreground">
							<span className="font-medium">{progress.percentageRequired}%</span> Required
						</div>
						<div className="text-sm text-muted-foreground">
							<span className="font-medium">{progress.percentageRecommended}%</span> Recommended
						</div>
						<div className="text-xs text-muted-foreground mt-2">
							{progress.completedRequired}/{progress.totalSkills} skills met
						</div>
					</div>
				)}
			</div>
		</Card>
	)
}
