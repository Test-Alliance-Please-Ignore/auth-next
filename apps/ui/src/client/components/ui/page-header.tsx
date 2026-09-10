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
		<div className={cn('page-header mb-6', className)}>
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{title}</h1>
					{description && <div className="text-muted-foreground mt-1">{description}</div>}
				</div>
				{action && <div className="flex-shrink-0">{action}</div>}
			</div>
		</div>
	)
}
