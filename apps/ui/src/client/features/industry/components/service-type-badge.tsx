import {
	Boxes,
	Building2,
	FlaskConical,
	PackageSearch,
	Rocket,
	ScrollText,
	Settings,
	ShoppingCart,
	Sparkles,
	Truck,
	Waypoints,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'

import { SERVICE_TYPE_LABELS, ServiceType } from '../types'

const SERVICE_TYPE_ICONS: Record<ServiceType, typeof Boxes> = {
	[ServiceType.GENERAL_MANUFACTURING]: Boxes,
	[ServiceType.CAPITAL_SHIP_MANUFACTURING]: Building2,
	[ServiceType.SUPERCAPITAL_SHIP_MANUFACTURING]: Rocket,
	[ServiceType.RESEARCHING]: FlaskConical,
	[ServiceType.BLUEPRINT_COPYING]: ScrollText,
	[ServiceType.INVENTION]: Sparkles,
	[ServiceType.REACTION]: Settings,
	[ServiceType.HAULING]: Truck,
	[ServiceType.CUSTOM_HAULING]: Truck,
	[ServiceType.BUYBACK]: ShoppingCart,
	[ServiceType.ACQUISITION]: PackageSearch,
	[ServiceType.BOOKMARKS]: Waypoints,
	[ServiceType.OTHER_SERVICE]: Settings,
}

interface ServiceTypeBadgeProps {
	type: ServiceType
	showIcon?: boolean
	className?: string
}

export function ServiceTypeBadge({ type, showIcon = true, className }: ServiceTypeBadgeProps) {
	const Icon = SERVICE_TYPE_ICONS[type]
	const label = SERVICE_TYPE_LABELS[type]

	return (
		<Badge variant="secondary" className={className}>
			{showIcon && <Icon className="mr-1 h-3 w-3" />}
			{label}
		</Badge>
	)
}
