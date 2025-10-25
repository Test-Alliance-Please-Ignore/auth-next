import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
	size?: 'sm' | 'md' | 'lg'
	label?: string
	className?: string
}

/**
 * Centralized loading spinner component
 * Provides consistent loading UI across the application
 */
export function LoadingSpinner({
	size = 'md',
	label = 'Loading...',
	className,
}: LoadingSpinnerProps) {
	const sizeClasses = {
		sm: 'h-8 w-8',
		md: 'h-12 w-12',
		lg: 'h-16 w-16',
	}

	return (
		<div
			className={cn('flex items-center justify-center', className)}
			role="status"
			aria-live="polite"
			aria-label={label}
		>
			<div className="text-center">
				<svg
					className={cn('animate-spin mx-auto text-primary', sizeClasses[size])}
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<circle
						className="opacity-25"
						cx="12"
						cy="12"
						r="10"
						stroke="currentColor"
						strokeWidth="4"
					/>
					<path
						className="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					/>
				</svg>
				{label && (
					<p className="mt-4 text-muted-foreground text-sm" aria-hidden="true">
						{label}
					</p>
				)}
			</div>
		</div>
	)
}

/**
 * Full-page loading component
 * Centers spinner in viewport
 */
export function LoadingPage({ label }: { label?: string }) {
	return (
		<div className="min-h-screen flex items-center justify-center">
			<LoadingSpinner size="lg" label={label} />
		</div>
	)
}

/**
 * Inline loading component for buttons
 */
export function LoadingInline({ className }: { className?: string }) {
	return (
		<svg
			className={cn('animate-spin h-4 w-4', className)}
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
			<path
				className="opacity-75"
				fill="currentColor"
				d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
			/>
		</svg>
	)
}
