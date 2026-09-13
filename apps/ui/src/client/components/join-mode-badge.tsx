import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

import type { JoinMode } from '@/lib/api'

interface JoinModeBadgeProps {
	joinMode: JoinMode
	className?: string
}

export function JoinModeBadge({ joinMode, className }: JoinModeBadgeProps) {
	const { t } = useAppTranslation()
	const config = {
		open: {
			variant: 'default' as const,
			label: t('groups.badges.open'),
		},
		approval: {
			variant: 'secondary' as const,
			label: t('groups.badges.approval'),
		},
		invitation_only: {
			variant: 'ghost' as const,
			label: t('groups.badges.invitationOnly'),
		},
		admin_managed: {
			variant: 'secondary' as const,
			label: t('groups.badges.adminManaged'),
		},
	}

	const { variant, label } = config[joinMode]

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
