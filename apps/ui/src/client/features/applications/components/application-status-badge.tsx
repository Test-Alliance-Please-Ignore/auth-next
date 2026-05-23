/**
 * Application Status Badge Component
 *
 * Displays application status with appropriate color coding and optional icon.
 * Follows the Caldari-themed design system with space-themed colors.
 */

import { AlertCircle, Check, CircleCheckBig, Clock, Eye, Minus, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { BadgeVariant } from '@/components/ui/badge'
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
		variant: BadgeVariant
	}
> = {
	pending: {
		label: 'Pending',
		icon: Clock,
		variant: 'warning',
	},
	under_review: {
		label: 'Under Review',
		icon: Eye,
		variant: 'default',
	},
	accepted: {
		label: 'Accepted',
		icon: Check,
		variant: 'success',
	},
	completed: {
		label: 'Completed',
		icon: CircleCheckBig,
		variant: 'success',
	},
	rejected: {
		label: 'Rejected',
		icon: XCircle,
		variant: 'destructive',
	},
	withdrawn: {
		label: 'Withdrawn',
		icon: Minus,
		variant: 'ghost',
	},
}

const unknownStatusConfig = {
	label: 'Unknown Status',
	icon: AlertCircle,
	variant: 'ghost' as BadgeVariant,
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
			variant={config.variant}
			className={cn('inline-flex items-center gap-1.5 font-medium', sizeClasses[size], className)}
		>
			{showIcon && <Icon className={iconSizeClasses[size]} />}
			<span>{config.label}</span>
		</Badge>
	)
}
