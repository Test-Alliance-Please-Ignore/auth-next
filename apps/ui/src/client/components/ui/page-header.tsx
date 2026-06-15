import * as React from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
	title: string
	description?: React.ReactNode
	action?: React.ReactNode
	className?: string
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
	return (
		<div className={cn('mb-section md:mb-10', className)}>
			<div className="flex items-start justify-between gap-4">
				<div className="space-y-3">
					<h1 className="py-1 text-4xl md:text-5xl font-bold leading-[1.2] gradient-text">
						{title}
					</h1>
					{description && <div className="text-muted-foreground text-lg">{description}</div>}
				</div>
				{action && <div className="flex-shrink-0">{action}</div>}
			</div>
		</div>
	)
}
