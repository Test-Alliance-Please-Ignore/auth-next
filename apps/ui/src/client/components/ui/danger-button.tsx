import { AlertTriangle, Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface DangerButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
	showIcon?: boolean
}

/**
 * Enhanced danger button with red destructive styling.
 * Mirrors Confirm/Cancel wrappers but uses destructive red tokens.
 */
const DangerButton = React.forwardRef<HTMLButtonElement, DangerButtonProps>(
	({ className, children, loading, loadingText, disabled, showIcon = true, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))]',
					'border-2 border-[hsl(var(--destructive))]/70',
					'shadow-lg shadow-[hsl(var(--destructive))]/25',
					'hover:bg-[hsl(var(--destructive))]/90',
					'hover:shadow-xl hover:shadow-[hsl(var(--destructive))]/40',
					'hover:border-[hsl(var(--destructive))]/70',
					'focus-visible:ring-2 focus-visible:ring-[hsl(var(--destructive))] focus-visible:ring-offset-2',
					'transition-all duration-200',
					'cursor-pointer disabled:cursor-not-allowed',
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
DangerButton.displayName = 'DangerButton'

export { DangerButton }
