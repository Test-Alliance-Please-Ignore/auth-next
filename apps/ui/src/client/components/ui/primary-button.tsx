import { Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface PrimaryButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
}

/**
 * Enhanced primary button with blue glow styling.
 * Mirrors the styled wrapper family used by confirm/cancel/destructive variants.
 */
const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
	({ className, children, loading, loadingText, disabled, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					'bg-primary text-primary-foreground',
					'border-2 border-primary/70',
					'shadow-lg shadow-primary/25',
					'hover:bg-primary/90',
					'hover:shadow-xl hover:shadow-primary/40',
					'hover:border-primary/70',
					'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
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
					children
				)}
			</Button>
		)
	}
)
PrimaryButton.displayName = 'PrimaryButton'

export { PrimaryButton }
