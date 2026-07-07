import type { MarketStatus } from '@repo/prediction-markets'

/**
 * Allowed market status transitions. `resolved` and `voided` are terminal.
 * Enforced on every write — corrections are new compensating actions, never
 * in-place edits.
 */
const TRANSITIONS: Record<MarketStatus, MarketStatus[]> = {
	draft: ['open', 'voided'],
	open: ['closed', 'voided'],
	closed: ['resolving', 'resolved', 'voided'],
	resolving: ['resolved', 'voided'],
	resolved: [],
	voided: [],
}

export function canTransition(from: MarketStatus, to: MarketStatus): boolean {
	return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from: MarketStatus, to: MarketStatus): void {
	if (!canTransition(from, to)) {
		throw new Error(`prediction-markets: invalid market transition ${from} → ${to}`)
	}
}

export function isTerminal(status: MarketStatus): boolean {
	return status === 'resolved' || status === 'voided'
}
