import * as React from 'react'

import { useLayoutContainerSize } from '@/hooks/useLayoutContainerSize'
import { cn } from '@/lib/utils'

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
	size?: 'default' | 'wide' | 'narrow' | 'full'
}

export function Container({ size = 'default', className, ...props }: ContainerProps) {
	const sizeOverride = useLayoutContainerSize(null)

	const effectiveSize = sizeOverride ?? size

	return (
		<div
			className={cn(
				'container mx-auto px-4 py-page',
				effectiveSize === 'default' && 'max-w-6xl',
				effectiveSize === 'wide' && 'max-w-7xl',
				effectiveSize === 'narrow' && 'max-w-4xl',
				effectiveSize === 'full' && 'max-w-full',
				className
			)}
			{...props}
		/>
	)
}
