import { CheckCircle, Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface SuccessButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
	showIcon?: boolean // Default true - shows success icon
}

/**
 * Enhanced success button with clear positive styling
 * - Green background with border
 * - Elevated shadow with success glow
 * - Strong hover states
 * - Loading state support
 *
 * Use for positive/success actions: Approve, Accept, Enable, etc.
 */
const SuccessButton = React.forwardRef<HTMLButtonElement, SuccessButtonProps>(
	({ className, children, loading, loadingText, disabled, showIcon = true, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					// Success color scheme
					'bg-success text-success-foreground',
					'hover:bg-success/90',
					// Stronger default border - visible even without hover
					'border-2 border-success/50',
					// Default shadow with glow - visible at rest
					'shadow-lg shadow-success/25',
					// Enhanced hover state - stronger glow and border
					'hover:shadow-xl hover:shadow-success/40 hover:border-success/70',
					// Focus state with ring
					'focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-2',
					// Smooth transitions
					'transition-all duration-200',
					className
				)}
				{...props}
			>
				{loading ? (
					<>
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						{loadingText || 'Processing...'}
					</>
				) : (
					<>
						{showIcon && <CheckCircle className="mr-2 h-4 w-4" />}
						{children}
					</>
				)}
			</Button>
		)
	}
)
SuccessButton.displayName = 'SuccessButton'

export { SuccessButton }
