/**
 * HR Note Priority Badge Component
 *
 * Displays HR note priority level with appropriate color coding.
 * By default only shows high and critical priorities (optional showAll flag).
 */

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { HRNotePriority } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface HRNotePriorityBadgeProps {
	priority: HRNotePriority
	showAll?: boolean
	size?: 'sm' | 'md' | 'lg'
	className?: string
}

// ============================================================================
// Priority Configuration
// ============================================================================

const priorityConfig: Record<
	HRNotePriority,
	{
		label: string
		colorClasses: string
	}
> = {
	low: {
		label: 'Low',
		colorClasses: 'text-muted-foreground bg-muted/20 border-muted',
	},
	normal: {
		label: 'Normal',
		colorClasses: 'text-primary bg-primary/10 border-primary/30',
	},
	high: {
		label: 'High Priority',
		colorClasses: 'text-warning bg-warning/10 border-warning/30',
	},
	critical: {
		label: 'Critical',
		colorClasses: 'text-destructive bg-destructive/10 border-destructive/30',
	},
}

const sizeClasses = {
	sm: 'text-xs px-2 py-0.5',
	md: 'text-sm px-2.5 py-0.5',
	lg: 'text-base px-3 py-1',
}

// ============================================================================
// Component
// ============================================================================

/**
 * Badge component that displays HR note priority level
 * By default only renders for high and critical priorities
 *
 * @example
 * ```tsx
 * <HRNotePriorityBadge priority="high" />
 * <HRNotePriorityBadge priority="normal" showAll />
 * ```
 */
export function HRNotePriorityBadge({
	priority,
	showAll = false,
	size = 'sm',
	className,
}: HRNotePriorityBadgeProps) {
	// Only show high and critical by default
	if (!showAll && priority !== 'high' && priority !== 'critical') {
		return null
	}

	const config = priorityConfig[priority]

	return (
		<Badge
			className={cn(
				'inline-flex items-center font-semibold border uppercase tracking-wide',
				config.colorClasses,
				sizeClasses[size],
				className
			)}
		>
			{config.label}
		</Badge>
	)
}
