import { HoverPopover } from '@/components/ui/hover-popover'
import { DirectorStatusBadge } from '@/components/DirectorStatusBadge'

import type { DirectorHealth } from '@/lib/api'

interface DirectorHealthBadgeProps {
	director: DirectorHealth
}

export function DirectorHealthBadge({ director }: DirectorHealthBadgeProps) {
	const hasUnhealthyReason =
		!director.isHealthy && Boolean(director.unhealthyReason?.summary || director.lastFailureReason)

	if (!hasUnhealthyReason) {
		return <DirectorStatusBadge director={director} />
	}

	return (
		<HoverPopover
			align="start"
			className="w-[28rem] space-y-2"
			trigger={
				<div className="inline-block cursor-help">
					<DirectorStatusBadge director={director} />
				</div>
			}
		>
				<div className="text-sm font-medium">Director Health Issues</div>
				<div className="text-sm text-muted-foreground">
					{director.unhealthyReason?.summary || director.lastFailureReason}
				</div>
				{director.unhealthyReason?.requiredRoles &&
				director.unhealthyReason.requiredRoles.length > 0 ? (
					<div className="text-xs text-muted-foreground">
						Required Roles: {director.unhealthyReason.requiredRoles.join(', ')}
					</div>
				) : null}
				{director.unhealthyReason?.missingRoles && director.unhealthyReason.missingRoles.length > 0 ? (
					<div className="text-xs text-muted-foreground">
						Missing Roles: {director.unhealthyReason.missingRoles.join(', ')}
					</div>
				) : null}
		</HoverPopover>
	)
}
