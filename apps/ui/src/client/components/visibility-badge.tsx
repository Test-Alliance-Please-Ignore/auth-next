import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

import type { Visibility } from '@/lib/api'

interface VisibilityBadgeProps {
	visibility: Visibility
	className?: string
}

export function VisibilityBadge({ visibility, className }: VisibilityBadgeProps) {
	const { t } = useAppTranslation()
	const config = {
		public: {
			variant: 'default' as const,
			label: t('groups.badges.public'),
		},
		hidden: {
			variant: 'secondary' as const,
			label: t('groups.badges.hidden'),
		},
		system: {
			variant: 'destructive' as const,
			label: t('groups.badges.system'),
		},
	}

	const { variant, label } = config[visibility]

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
