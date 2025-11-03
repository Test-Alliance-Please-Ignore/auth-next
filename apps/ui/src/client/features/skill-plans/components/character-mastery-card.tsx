import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
					boxClass: 'border-green-500 text-green-500',
					bgClass: 'bg-green-500/20',
					icon: <CheckCircle2 className="h-5 w-5" />,
					text: 'Fully Trained',
					progressPercent: 100,
				}
			case 'meets_minimum':
				return {
					boxClass: 'border-yellow-500 text-yellow-500',
					bgClass: 'bg-yellow-500/20',
					icon: <AlertCircle className="h-5 w-5" />,
					text: 'Meets Requirements',
					progressPercent: 100,
				}
			case 'insufficient':
			default:
				// Calculate color gradient based on actual progress percentage
				let bgClass = 'bg-muted/20'
				let borderColor = 'border-muted'
				let textColor = 'text-muted-foreground'
				let icon = <XCircle className="h-5 w-5" />

				if (progressPercent >= 90) {
					// Almost there! - use amber
					bgClass = 'bg-amber-500/20'
					borderColor = 'border-amber-500'
					textColor = 'text-amber-500'
					icon = <AlertCircle className="h-5 w-5" />
				} else if (progressPercent >= 75) {
					// Getting close - use orange
					bgClass = 'bg-orange-500/20'
					borderColor = 'border-orange-500'
					textColor = 'text-orange-500'
					icon = <AlertCircle className="h-5 w-5" />
				} else if (progressPercent >= 60) {
					// Good progress - use blue
					bgClass = 'bg-blue-500/20'
					borderColor = 'border-blue-500'
					textColor = 'text-blue-500'
				} else if (progressPercent >= 40) {
					// Some progress - use indigo
					bgClass = 'bg-indigo-500/20'
					borderColor = 'border-indigo-500'
					textColor = 'text-indigo-500'
				} else if (progressPercent >= 20) {
					// Early progress - use purple
					bgClass = 'bg-purple-500/20'
					borderColor = 'border-purple-500'
					textColor = 'text-purple-500'
				} else if (progressPercent > 0) {
					// Just started - use slate
					bgClass = 'bg-slate-500/20'
					borderColor = 'border-slate-500'
					textColor = 'text-slate-500'
				} else {
					// No progress - use muted gray
					bgClass = 'bg-muted/20'
					borderColor = 'border-muted'
					textColor = 'text-muted-foreground'
				}

				return {
					boxClass: `${borderColor} ${textColor}`,
					bgClass,
					icon,
					text: progressPercent === 0 ? 'Training Needed' : 'In Progress',
					progressPercent,
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
						<span className="text-sm font-medium">
							{masteryStatus === 'insufficient' && statusDisplay.progressPercent > 0
								? `${Math.floor(statusDisplay.progressPercent / 5) * 5}% Trained`
								: statusDisplay.text}
						</span>
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
