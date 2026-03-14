import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface FilterFieldProps {
	label: string
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
