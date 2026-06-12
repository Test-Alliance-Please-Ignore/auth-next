export const STRUCTURE_STATE_CHOICES = [
	'anchor_vulnerable',
	'anchoring',
	'armor_reinforce',
	'armor_vulnerable',
	'deploy_vulnerable',
	'hull_reinforce',
	'hull_vulnerable',
	'onlining_vulnerable',
	'shield_vulnerable',
	'unanchored',
	'unknown',
] as const

export type StructureStateChoice = (typeof STRUCTURE_STATE_CHOICES)[number]

export const STRUCTURE_STATE_OPTIONS = [
	{ value: 'anchor_vulnerable', label: 'Anchoring (Vulnerable)' },
	{ value: 'anchoring', label: 'Anchoring (Invulnerable)' },
	{ value: 'armor_reinforce', label: 'Reinforced (Armor)' },
	{ value: 'armor_vulnerable', label: 'Vulnerable (Armor)' },
	{ value: 'deploy_vulnerable', label: 'Vulnerable (Deploy)' },
	{ value: 'hull_reinforce', label: 'Reinforced (Hull)' },
	{ value: 'hull_vulnerable', label: 'Vulnerable (Hull)' },
	{ value: 'onlining_vulnerable', label: 'Onlining (Vulnerable)' },
	{ value: 'shield_vulnerable', label: 'Shield (Vulnerable)' },
	{ value: 'unanchored', label: 'Unanchored' },
	{ value: 'unknown', label: 'Unknown' },
] as const

export type StructureStateOption = (typeof STRUCTURE_STATE_OPTIONS)[number]
