import { Building2, Factory, Sword, User } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import { ENTITY_TYPE_LABELS, IndustryEntityType } from '../types'

const ENTITY_TYPE_ICONS: Record<IndustryEntityType, typeof User> = {
	[IndustryEntityType.USER]: User,
	[IndustryEntityType.CHARACTER]: User,
	[IndustryEntityType.CORPORATION]: Building2,
	[IndustryEntityType.ALLIANCE]: Sword,
	[IndustryEntityType.SERVICE_PROVIDER]: Factory,
}

interface EntityTypeBadgeProps {
	type: IndustryEntityType
	showIcon?: boolean
	className?: string
}

export function EntityTypeBadge({ type, showIcon = true, className }: EntityTypeBadgeProps) {
	const Icon = ENTITY_TYPE_ICONS[type]
	const label = ENTITY_TYPE_LABELS[type]

	return (
		<Badge variant="ghost" className={className}>
			{showIcon && <Icon className="mr-1 h-3 w-3" />}
			{label}
		</Badge>
	)
}
