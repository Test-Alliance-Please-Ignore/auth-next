/**
 * HR Note Type Badge Component
 *
 * Displays HR note type with appropriate color coding and icon.
 * Used to categorize notes: general, warning, positive, incident, background_check.
 */

import { AlertOctagon, AlertTriangle, CheckCircle, Info, Shield } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { BadgeVariant } from '@/components/ui/badge'
import type { HRNoteType } from '../api'

// ============================================================================
// Types
// ============================================================================

export interface HRNoteTypeBadgeProps {
	noteType: HRNoteType
	size?: 'sm' | 'md' | 'lg'
	showIcon?: boolean
	className?: string
}

// ============================================================================
// Note Type Configuration
// ============================================================================

const noteTypeConfig: Record<
	HRNoteType,
	{
		label: string
		icon: typeof Info
		variant: BadgeVariant
	}
> = {
	general: {
		label: 'General',
		icon: Info,
		variant: 'ghost',
	},
	warning: {
		label: 'Warning',
		icon: AlertTriangle,
		variant: 'warning',
	},
	positive: {
		label: 'Positive',
		icon: CheckCircle,
		variant: 'success',
	},
	incident: {
		label: 'Incident',
		icon: AlertOctagon,
		variant: 'destructive',
	},
	background_check: {
		label: 'Background Check',
		icon: Shield,
		variant: 'default',
	},
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
 * Badge component that displays HR note type with color and icon
 *
 * @example
 * ```tsx
 * <HRNoteTypeBadge noteType="warning" showIcon />
 * <HRNoteTypeBadge noteType="incident" size="lg" />
 * ```
 */
export function HRNoteTypeBadge({
	noteType,
	size = 'md',
	showIcon = true,
	className,
}: HRNoteTypeBadgeProps) {
	const config = noteTypeConfig[noteType]
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
