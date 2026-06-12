import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TableRefreshFrameProps {
	children: ReactNode
	isRefreshing?: boolean
	refreshMessage?: string
	errorMessage?: string | null
	errorTitle?: string
	onRetry?: () => void
	retryLabel?: string
	retryDisabled?: boolean
	className?: string
}

export function TableRefreshFrame({
	children,
	isRefreshing = false,
	refreshMessage = 'Refreshing data...',
	errorMessage,
	errorTitle = 'Latest refresh failed. Showing last loaded results.',
	onRetry,
	retryLabel = 'Retry',
	retryDisabled = false,
	className,
}: TableRefreshFrameProps) {
	return (
		<div className={cn('space-y-3', className)}>
			{errorMessage && (
				<div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0">
							<p className="font-medium">{errorTitle}</p>
							<p className="text-xs text-muted-foreground">{errorMessage}</p>
						</div>
						{onRetry ? (
							<Button variant="secondary" size="sm" onClick={onRetry} disabled={retryDisabled}>
								{retryDisabled ? <Loader2 className="h-4 w-4 animate-spin" /> : retryLabel}
							</Button>
						) : null}
					</div>
				</div>
			)}

			<div className="relative">
				{isRefreshing && (
					<div className="pointer-events-none absolute inset-0 z-10 rounded-md bg-background/60 backdrop-blur-[1px]" />
				)}
				<div className={isRefreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'}>{children}</div>
			</div>

			{isRefreshing && (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					<span>{refreshMessage}</span>
				</div>
			)}
		</div>
	)
}
