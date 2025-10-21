import { Badge } from '@/components/ui/badge'

import type { Visibility } from '@/lib/api'

interface VisibilityBadgeProps {
	visibility: Visibility
	className?: string
}

export function VisibilityBadge({ visibility, className }: VisibilityBadgeProps) {
	const config = {
		public: {
			variant: 'default' as const,
			label: 'Public',
		},
		hidden: {
			variant: 'secondary' as const,
			label: 'Hidden',
		},
		system: {
			variant: 'destructive' as const,
			label: 'System',
		},
	}

	const { variant, label } = config[visibility]

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
