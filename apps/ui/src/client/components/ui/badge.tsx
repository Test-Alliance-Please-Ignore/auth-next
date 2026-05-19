import { cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

import type { VariantProps } from 'class-variance-authority'

const badgeVariants = cva(
	'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
	{
		variants: {
			variant: {
				default: 'bg-primary/20 text-primary border-primary/30',
				secondary: 'bg-secondary/20 text-secondary border-secondary/30',
				success: 'bg-success/20 text-success border-success/30',
				warning: 'bg-warning/20 text-warning border-warning/30',
				gold: 'bg-amber-400/20 text-amber-300 border-amber-300/40',
				destructive: 'bg-destructive/20 text-destructive border-destructive/30',
				ghost: 'bg-muted/50 text-muted-foreground border-border',
				special: 'bg-purple-500/20 text-purple-500 border-purple-500/30',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	}
)

export type BadgeVariant = VariantProps<typeof badgeVariants>['variant']

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {
	icon?: React.ComponentType<{ className?: string }>
	iconPosition?: 'left' | 'right'
}

function Badge({ className, variant, icon: Icon, iconPosition = 'left', children, ...props }: BadgeProps) {
	return (
		<div className={cn(badgeVariants({ variant }), Icon && 'gap-1', className)} {...props}>
			{Icon && iconPosition === 'left' && <Icon className="h-3 w-3 shrink-0" />}
			{children}
			{Icon && iconPosition === 'right' && <Icon className="h-3 w-3 shrink-0" />}
		</div>
	)
}

export { Badge, badgeVariants }
