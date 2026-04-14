import { getIdClassification } from '@repo/esi'

/**
 * Determine whether a corporation ID belongs to an NPC corporation.
 * CCP reserves 1,000,000–1,999,999 for NPC corporations.
 */
export function isNpcCorporationId(corporationId: string): boolean {
	return getIdClassification(corporationId).type === 'npc_corporation'
}

