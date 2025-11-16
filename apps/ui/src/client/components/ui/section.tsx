import * as React from 'react'

import { cn } from '@/lib/utils'

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
	title?: string
	description?: string
}

export function Section({ className, title, description, children, ...props }: SectionProps) {
	return (
		<section className={cn('space-y-4', className)} {...props}>
			{(title || description) && (
				<div className="mb-4">
					{title && <h2 className="text-2xl font-semibold">{title}</h2>}
					{description && <p className="text-muted-foreground text-sm">{description}</p>}
				</div>
			)}
			{children}
		</section>
	)
}
