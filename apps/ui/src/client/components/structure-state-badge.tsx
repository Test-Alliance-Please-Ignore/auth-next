import { getStructureStateBadgeState } from '@repo/structure-states'

import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'
import { formatStructureLabel } from '@/lib/structure-labels'

export function StructureStateBadge({ state, className }: { state: string; className?: string }) {
	useAppTranslation()
	const { label, variant } = getStructureStateBadgeState(state)

	return (
		<Badge variant={variant} className={className}>
			{formatStructureLabel(state, label)}
		</Badge>
	)
}
