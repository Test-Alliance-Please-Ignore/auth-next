import { Loader2, X } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface CancelButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
	showIcon?: boolean // Default true - shows X icon
}

/**
 * Enhanced cancel button with clear dismissive styling
 * - Neutral gray background at rest
 * - Reddish warning color on hover
 * - Elevated shadow with subtle glow
 * - Strong hover states
 * - Loading state support
 *
 * Use for dismissive/cancel actions: Cancel, Close, Dismiss, etc.
 */
const CancelButton = React.forwardRef<HTMLButtonElement, CancelButtonProps>(
	({ className, children, loading, loadingText, disabled, showIcon = true, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					// Neutral gray background at rest - visible default state
					'bg-[hsl(var(--cancel))] text-[hsl(var(--cancel-foreground))]',
					// Stronger default border - visible even without hover
					'border-2 border-[hsl(var(--cancel))]/70',
					// Default shadow with glow - visible at rest
					'shadow-lg shadow-[hsl(var(--cancel))]/25',
					// Enhanced hover state - reddish warning color
					'hover:bg-[hsl(var(--cancel-hover))] hover:text-white',
					'hover:shadow-xl hover:shadow-[hsl(var(--cancel-hover))]/40',
					'hover:border-[hsl(var(--cancel-hover))]/70',
					// Focus state with ring
					'focus-visible:ring-2 focus-visible:ring-[hsl(var(--cancel))] focus-visible:ring-offset-2',
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
						{showIcon && <X className="mr-2 h-4 w-4" />}
						{children}
					</>
				)}
			</Button>
		)
	}
)
CancelButton.displayName = 'CancelButton'

export { CancelButton }
