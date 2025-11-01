/**
 * Application Stats Card Component
 *
 * Compact card for displaying application statistics on the dashboard.
 * Shows a single statistic with a label and value, using status-based colors.
 */

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { ApplicationStatus } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationStatsCardProps {
	label: string
	value: number
	variant?: ApplicationStatus | 'all'
	className?: string
}

// ============================================================================
// Variant Styles
// ============================================================================

/**
 * Maps status variants to color classes
 */
const variantStyles: Record<ApplicationStatus | 'all', string> = {
	all: 'border-border bg-card',
	pending: 'border-accent/50 bg-accent/5',
	under_review: 'border-primary/50 bg-primary/5',
	accepted: 'border-success/50 bg-success/5',
	rejected: 'border-destructive/50 bg-destructive/5',
	withdrawn: 'border-muted/50 bg-muted/5',
}

const valueStyles: Record<ApplicationStatus | 'all', string> = {
	all: 'text-foreground',
	pending: 'text-accent-foreground',
	under_review: 'text-primary',
	accepted: 'text-success',
	rejected: 'text-destructive',
	withdrawn: 'text-muted-foreground',
}

// ============================================================================
// Component
// ============================================================================

/**
 * Statistics card for displaying application counts
 *
 * @example
 * ```tsx
 * <ApplicationStatsCard
 *   label="Pending"
 *   value={5}
 *   variant="pending"
 * />
 * ```
 */
export function ApplicationStatsCard({
	label,
	value,
	variant = 'all',
	className,
}: ApplicationStatsCardProps) {
	return (
		<Card className={cn('border-2', variantStyles[variant], className)}>
			<CardContent className="p-4">
				<div className="space-y-1">
					<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
						{label}
					</p>
					<p className={cn('text-3xl font-bold', valueStyles[variant])}>{value}</p>
				</div>
			</CardContent>
		</Card>
	)
}
