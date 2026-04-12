import * as React from 'react'

import { cn } from '@/lib/utils'

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
	size?: 'default' | 'wide' | 'narrow' | 'full'
}

export function Container({ size: _size = 'default', className, ...props }: ContainerProps) {

	return (
		<div
			className={cn('container mx-auto max-w-[120rem] px-4 py-page', className)}
			{...props}
		/>
	)
}
