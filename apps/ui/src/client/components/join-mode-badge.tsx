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
			variant: 'outline' as const,
			label: 'Invitation Only',
		},
	}

	const { variant, label } = config[joinMode]

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
