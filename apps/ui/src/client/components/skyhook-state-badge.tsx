import { Badge } from '@/components/ui/badge'
import { i18n, useAppTranslation } from '@/i18n'

type SkyhookState = 'vulnerable' | 'invulnerable' | 'reinforced'

function getSkyhookStateBadgeState(state: string): {
	label: string
	variant: 'ghost' | 'success' | 'destructive'
} {
	switch (state.trim().toLowerCase() as SkyhookState) {
		case 'reinforced':
			return { label: i18n.t('structures.reinforced'), variant: 'destructive' }
		case 'invulnerable':
			return { label: i18n.t('structures.invulnerable'), variant: 'ghost' }
		case 'vulnerable':
		default:
			return { label: i18n.t('structures.vulnerable'), variant: 'success' }
	}
}

export function SkyhookStateBadge({ state, className }: { state: string; className?: string }) {
	useAppTranslation()
	const { label, variant } = getSkyhookStateBadgeState(state)

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
