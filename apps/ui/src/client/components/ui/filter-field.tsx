import { cn } from '@/lib/utils'

import type { ReactNode } from 'react'

interface FilterFieldProps {
	label: ReactNode
	children: ReactNode
	className?: string
}

export function FilterField({ label, children, className }: FilterFieldProps) {
	return (
		<div className={cn('space-y-1.5', className)}>
			<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			{children}
		</div>
	)
}
