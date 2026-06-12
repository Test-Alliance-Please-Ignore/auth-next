import { Badge } from '@/components/ui/badge'

import { getStructureStateBadgeState } from '@repo/structure-states'

export function StructureStateBadge({ state, className }: { state: string; className?: string }) {
	const { label, variant } = getStructureStateBadgeState(state)

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
