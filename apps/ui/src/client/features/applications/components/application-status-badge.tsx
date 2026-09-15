/**
 * Application Status Badge Component
 *
 * Displays application status with appropriate color coding and optional icon.
 * Follows the Caldari-themed design system with space-themed colors.
 */

import { AlertCircle, Check, CircleCheckBig, Clock, Eye, Minus, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import type { BadgeVariant } from '@/components/ui/badge'
import type { AppTranslationKey } from '@/i18n'
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
		labelKey: AppTranslationKey
		icon: typeof Clock
		variant: BadgeVariant
	}
> = {
	pending: {
		labelKey: 'applications.status.pending',
		icon: Clock,
		variant: 'warning',
	},
	under_review: {
		labelKey: 'applications.status.under_review',
		icon: Eye,
		variant: 'default',
	},
	accepted: {
		labelKey: 'applications.status.accepted',
		icon: Check,
		variant: 'success',
	},
	completed: {
		labelKey: 'applications.status.completed',
		icon: CircleCheckBig,
		variant: 'success',
	},
	rejected: {
		labelKey: 'applications.status.rejected',
		icon: XCircle,
		variant: 'destructive',
	},
	withdrawn: {
		labelKey: 'applications.status.withdrawn',
		icon: Minus,
		variant: 'ghost',
	},
}

const unknownStatusConfig = {
	labelKey: 'applications.status.unknown' as const,
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
	const { t } = useAppTranslation()
	const config = Object.hasOwn(statusConfig, status)
		? statusConfig[status as ApplicationStatus]
		: unknownStatusConfig
	const Icon = config.icon

	return (
		<Badge
			variant={config.variant}
			className={cn('inline-flex items-center gap-1.5 font-medium', sizeClasses[size], className)}
		>
			{showIcon && <Icon className={iconSizeClasses[size]} />}
			<span>{t(config.labelKey)}</span>
		</Badge>
	)
}
