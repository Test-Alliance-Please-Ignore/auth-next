import * as React from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
	title: string
	description?: string
	className?: string
}

export function PageHeader({ title, description, className }: PageHeaderProps) {
	return (
		<div className={cn('mb-section', className)}>
			<h1 className="text-4xl md:text-5xl font-bold gradient-text">{title}</h1>
			{description && <p className="text-muted-foreground mt-2 text-lg">{description}</p>}
		</div>
	)
}
