import * as React from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
	title: string
	description?: string
	action?: React.ReactNode
	className?: string
}

export function PageHeader({ title, description, action, className }: PageHeaderProps) {
	return (
		<div className={cn('mb-section', className)}>
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-4xl md:text-5xl font-bold gradient-text">{title}</h1>
					{description && <p className="text-muted-foreground mt-2 text-lg">{description}</p>}
				</div>
				{action && <div className="flex-shrink-0">{action}</div>}
			</div>
		</div>
	)
}
