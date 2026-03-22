import { Loader2 } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

import type { ButtonProps } from './button'

export interface GhostButtonProps extends Omit<ButtonProps, 'variant'> {
	loading?: boolean
	loadingText?: string
}

/**
 * Enhanced ghost/outline-style button with subtle gray underglow.
 * Keeps a low-emphasis visual profile while matching the styled button family.
 */
const GhostButton = React.forwardRef<HTMLButtonElement, GhostButtonProps>(
	({ className, children, loading, loadingText, disabled, ...props }, ref) => {
		const isDisabled = disabled || loading

		return (
			<Button
				ref={ref}
				variant="outline"
				disabled={isDisabled}
				className={cn(
					'bg-[hsl(var(--background))] text-[hsl(var(--foreground))]',
					'border-2 border-[hsl(var(--border-strong))/0.9]',
					// Match styled-button intensity profile (rest glow)
					'shadow-lg shadow-[hsl(var(--border-strong))]/30',
					'hover:bg-[hsl(var(--accent))]',
					'hover:border-[hsl(var(--border-strong))/0.95]',
					// Match styled-button intensity profile (hover glow)
					'hover:shadow-xl hover:shadow-[hsl(var(--border-strong))]/45',
					'focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
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

GhostButton.displayName = 'GhostButton'

export { GhostButton }
