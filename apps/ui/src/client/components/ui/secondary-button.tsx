import { Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface SecondaryButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
}

/**
 * Enhanced secondary button using the shared teal accent palette.
 * Use for non-destructive state transition actions.
 */
const SecondaryButton = React.forwardRef<HTMLButtonElement, SecondaryButtonProps>(
	({ className, children, loading, loadingText, disabled, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="default"
				disabled={isDisabled}
				className={cn(
					'bg-secondary text-secondary-foreground',
					'border-2 border-secondary/70',
					'shadow-lg shadow-secondary/25',
					'hover:bg-[hsl(var(--secondary-hover))] hover:text-secondary-foreground',
					'hover:shadow-xl hover:shadow-secondary/40',
					'hover:border-secondary/75',
					'focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2',
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
					children
				)}
			</Button>
		)
	}
)
SecondaryButton.displayName = 'SecondaryButton'

export { SecondaryButton }
