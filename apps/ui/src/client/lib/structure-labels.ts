import { i18n } from '@/i18n'

import type { AppTranslationKey } from '@/i18n'

const labelKeys: Record<string, AppTranslationKey> = {
	anchor_vulnerable: 'structures.display_anchor_vulnerable',
	anchoring: 'structures.display_anchoring',
	armor_reinforce: 'structures.display_armor_reinforce',
	armor_vulnerable: 'structures.display_armor_vulnerable',
	deploy_vulnerable: 'structures.display_deploy_vulnerable',
	invulnerable: 'structures.display_invulnerable',
	hull_reinforce: 'structures.display_hull_reinforce',
	hull_vulnerable: 'structures.display_hull_vulnerable',
	onlining_vulnerable: 'structures.display_onlining_vulnerable',
	offline: 'structures.display_offline',
	online: 'structures.display_online',
	onlining: 'structures.display_onlining',
	reinforced: 'structures.display_reinforced',
	vulnerable: 'structures.display_vulnerable',
	shield_vulnerable: 'structures.display_shield_vulnerable',
	unanchored: 'structures.display_unanchored',
	unanchoring: 'structures.display_unanchoring',
	unknown: 'structures.display_unknown',
	structures: 'structures.display_structures',
	sovereignty: 'structures.display_sovereignty',
	skyhooks: 'structures.display_skyhooks',
	'mining-citadels': 'structures.display_mining_citadels',
	'moon-drills': 'structures.display_moon_drills',
	poses: 'structures.display_poses',
}

export function formatStructureLabel(value: string, fallback = value): string {
	const key = labelKeys[value]
	return key ? i18n.t(key) : fallback
}
