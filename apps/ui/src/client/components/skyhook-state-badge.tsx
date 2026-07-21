import { Badge } from '@/components/ui/badge'

type SkyhookState = 'vulnerable' | 'invulnerable' | 'reinforced'

function getSkyhookStateBadgeState(state: string): { label: string; variant: 'ghost' | 'success' | 'destructive' } {
	switch (state.trim().toLowerCase() as SkyhookState) {
		case 'reinforced':
			return { label: 'Reinforced', variant: 'destructive' }
		case 'invulnerable':
			return { label: 'Invulnerable', variant: 'ghost' }
		case 'vulnerable':
		default:
			return { label: 'Vulnerable', variant: 'success' }
	}
}

export function SkyhookStateBadge({ state, className }: { state: string; className?: string }) {
	const { label, variant } = getSkyhookStateBadgeState(state)

	return (
		<Badge variant={variant} className={className}>
			{label}
		</Badge>
	)
}
