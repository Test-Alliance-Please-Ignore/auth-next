import { AlertTriangle, Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface DestructiveButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
	showIcon?: boolean // Default true - shows warning icon
}

/**
 * Enhanced destructive button with clear warning styling
 * - Sickly greenish-orange background (warning/caution)
 * - Elevated shadow with warning glow
 * - Strong hover states
 * - Loading state support
 *
 * Use for dangerous/destructive actions: Delete, Remove, Revoke, etc.
 */
const DestructiveButton = React.forwardRef<HTMLButtonElement, DestructiveButtonProps>(
	({ className, children, loading, loadingText, disabled, showIcon = true, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					// Sickly greenish-orange background at rest - visible warning state
					'bg-[hsl(var(--destructive-alt))] text-[hsl(var(--destructive-alt-foreground))]',
					// Stronger default border - visible even without hover
					'border-2 border-[hsl(var(--destructive-alt))]/70',
					// Default shadow with glow - visible at rest
					'shadow-lg shadow-[hsl(var(--destructive-alt))]/25',
					// Enhanced hover state - darker orange
					'hover:bg-[hsl(var(--destructive-alt-hover))]',
					'hover:shadow-xl hover:shadow-[hsl(var(--destructive-alt-hover))]/40',
					'hover:border-[hsl(var(--destructive-alt-hover))]/70',
					// Focus state with ring
					'focus-visible:ring-2 focus-visible:ring-[hsl(var(--destructive-alt))] focus-visible:ring-offset-2',
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
						{showIcon && <AlertTriangle className="mr-2 h-4 w-4" />}
						{children}
					</>
				)}
			</Button>
		)
	}
)
DestructiveButton.displayName = 'DestructiveButton'

export { DestructiveButton }
