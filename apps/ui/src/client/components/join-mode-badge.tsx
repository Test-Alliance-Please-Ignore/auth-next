import { Badge } from '@/components/ui/badge'

import type { JoinMode } from '@/lib/api'

interface JoinModeBadgeProps {
	joinMode: JoinMode
	className?: string
}

export function JoinModeBadge({ joinMode, className }: JoinModeBadgeProps) {
	const config = {
		open: {
			variant: 'default' as const,
			label: 'Open',
		},
		approval: {
			variant: 'secondary' as const,
			label: 'Approval Required',
		},
		invitation_only: {
			variant: 'ghost' as const,
			label: 'Invitation Only',
		},
		admin_managed: {
			variant: 'secondary' as const,
			label: 'Admin Managed',
		},
	}

	const { variant, label } = config[joinMode]

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
