import { Check, Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface ConfirmButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
	showIcon?: boolean // Default true - shows check icon
}

/**
 * Enhanced confirm button with clear visual styling
 * - Greenish success background
 * - Elevated shadow with subtle glow
 * - Strong hover states
 * - Loading state support
 *
 * Use for primary confirmation actions: Create, Attach, Transfer, Make Admin, etc.
 */
const ConfirmButton = React.forwardRef<HTMLButtonElement, ConfirmButtonProps>(
	({ className, children, loading, loadingText, disabled, showIcon = true, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					// Greenish success background at rest - visible default state
					'bg-[hsl(var(--confirm))] text-[hsl(var(--confirm-foreground))]',
					// Stronger default border - visible even without hover
					'border-2 border-[hsl(var(--confirm))]/70',
					// Default shadow with glow - visible at rest
					'shadow-lg shadow-[hsl(var(--confirm))]/25',
					// Enhanced hover state - darker green
					'hover:bg-[hsl(var(--confirm-hover))]',
					'hover:shadow-xl hover:shadow-[hsl(var(--confirm-hover))]/40',
					'hover:border-[hsl(var(--confirm-hover))]/70',
					// Focus state with ring
					'focus-visible:ring-2 focus-visible:ring-[hsl(var(--confirm))] focus-visible:ring-offset-2',
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
						{showIcon && <Check className="mr-2 h-4 w-4" />}
						{children}
					</>
				)}
			</Button>
		)
	}
)
ConfirmButton.displayName = 'ConfirmButton'

export { ConfirmButton }
