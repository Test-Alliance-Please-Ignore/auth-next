import { Check, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Step {
	label: string
	description?: string
}

interface WizardStepIndicatorProps {
	steps: Step[]
	currentStep: number
	onStepClick?: (step: number) => void
}

export function WizardStepIndicator({
	steps,
	currentStep,
	onStepClick,
}: WizardStepIndicatorProps) {
	return (
		<div className="flex items-center justify-center gap-2">
			{steps.map((step, index) => {
				const stepNumber = index + 1
				const isActive = stepNumber === currentStep
				const isCompleted = stepNumber < currentStep
				const isClickable = onStepClick && isCompleted

				return (
					<div key={stepNumber} className="flex items-center">
						<button
							type="button"
							onClick={() => isClickable && onStepClick(stepNumber)}
							disabled={!isClickable}
							className={cn(
								'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
								isActive && 'bg-primary/20 text-primary',
								isCompleted && 'bg-green-500/20 text-green-500',
								!isActive && !isCompleted && 'bg-muted text-muted-foreground',
								isClickable && 'cursor-pointer hover:bg-primary/30',
								!isClickable && 'cursor-default'
							)}
						>
							<span
								className={cn(
									'w-6 h-6 rounded-full flex items-center justify-center text-sm font-medium',
									isActive && 'bg-primary text-primary-foreground',
									isCompleted && 'bg-green-500 text-white',
									!isActive && !isCompleted && 'bg-muted-foreground/20 text-muted-foreground'
								)}
							>
								{isCompleted ? <Check className="h-4 w-4" /> : stepNumber}
							</span>
							<span className="font-medium">{step.label}</span>
						</button>

						{index < steps.length - 1 && (
							<ChevronRight className="h-4 w-4 mx-2 text-muted-foreground" />
						)}
					</div>
				)
			})}
		</div>
	)
}
