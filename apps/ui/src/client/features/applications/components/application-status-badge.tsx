/**
 * Application Status Badge Component
 *
 * Displays application status with appropriate color coding and optional icon.
 * Follows the Caldari-themed design system with space-themed colors.
 */

import { AlertCircle, CheckCircle, Clock, Eye, Minus, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { ApplicationStatus } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface ApplicationStatusBadgeProps {
	status: ApplicationStatus | string
	size?: 'sm' | 'md' | 'lg'
	showIcon?: boolean
	className?: string
}

// ============================================================================
// Status Configuration
// ============================================================================

const statusConfig: Record<
	ApplicationStatus,
	{
		label: string
		icon: typeof Clock
		colorClasses: string
	}
> = {
	pending: {
		label: 'Pending',
		icon: Clock,
		colorClasses: 'bg-warning/15 text-warning border-warning/40',
	},
	under_review: {
		label: 'Under Review',
		icon: Eye,
		colorClasses: 'bg-primary/20 text-primary border-primary/50',
	},
	accepted: {
		label: 'Accepted',
		icon: CheckCircle,
		colorClasses: 'bg-success/20 text-success border-success/50',
	},
	rejected: {
		label: 'Rejected',
		icon: XCircle,
		colorClasses: 'bg-destructive/20 text-destructive border-destructive/50',
	},
	withdrawn: {
		label: 'Withdrawn',
		icon: Minus,
		colorClasses: 'bg-muted/20 text-muted-foreground border-muted/50',
	},
}

const unknownStatusConfig = {
	label: 'Unknown Status',
	icon: AlertCircle,
	colorClasses: 'bg-muted/20 text-muted-foreground border-muted/50',
}

const sizeClasses = {
	sm: 'text-xs px-2 py-0.5',
	md: 'text-sm px-2.5 py-0.5',
	lg: 'text-base px-3 py-1',
}

const iconSizeClasses = {
	sm: 'h-3 w-3',
	md: 'h-3.5 w-3.5',
	lg: 'h-4 w-4',
}

// ============================================================================
// Component
// ============================================================================

/**
 * Badge component that displays application status with color and icon
 *
 * @example
 * ```tsx
 * <ApplicationStatusBadge status="pending" showIcon />
 * <ApplicationStatusBadge status="accepted" size="lg" />
 * ```
 */
export function ApplicationStatusBadge({
	status,
	size = 'md',
	showIcon = true,
	className,
}: ApplicationStatusBadgeProps) {
	const config = statusConfig[status as ApplicationStatus] ?? unknownStatusConfig
	const Icon = config.icon

	return (
		<Badge
			className={cn(
				'inline-flex items-center gap-1.5 font-medium border',
				config.colorClasses,
				sizeClasses[size],
				className
			)}
		>
			{showIcon && <Icon className={iconSizeClasses[size]} />}
			<span>{config.label}</span>
		</Badge>
	)
}
