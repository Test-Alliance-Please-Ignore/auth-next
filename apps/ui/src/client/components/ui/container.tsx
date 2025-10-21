import * as React from 'react'

import { cn } from '@/lib/utils'

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
	size?: 'default' | 'wide' | 'narrow'
}

export function Container({ size = 'default', className, ...props }: ContainerProps) {
	return (
		<div
			className={cn(
				'container mx-auto px-4 py-page',
				size === 'default' && 'max-w-6xl',
				size === 'wide' && 'max-w-7xl',
				size === 'narrow' && 'max-w-4xl',
				className
			)}
			{...props}
		/>
	)
}
