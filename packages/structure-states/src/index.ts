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

export type StructureStateBadgeVariant = 'destructive' | 'ghost' | 'secondary' | 'special' | 'success' | 'warning'

export interface StructureStateBadgeState {
	label: string
	variant: StructureStateBadgeVariant
}

const STRUCTURE_STATE_LABEL_BY_VALUE: Record<StructureStateChoice, string> = Object.fromEntries(
	STRUCTURE_STATE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<StructureStateChoice, string>

const STRUCTURE_STATE_BADGE_VARIANT_BY_VALUE: Record<StructureStateChoice, StructureStateBadgeVariant> = {
	anchor_vulnerable: 'warning',
	anchoring: 'special',
	armor_reinforce: 'destructive',
	armor_vulnerable: 'warning',
	deploy_vulnerable: 'warning',
	hull_reinforce: 'destructive',
	hull_vulnerable: 'warning',
	onlining_vulnerable: 'warning',
	shield_vulnerable: 'success',
	unanchored: 'ghost',
	unknown: 'secondary',
}

export function isStructureStateChoice(value: string): value is StructureStateChoice {
	return STRUCTURE_STATE_CHOICES.includes(value as StructureStateChoice)
}

export function getStructureStateBadgeState(state: string): StructureStateBadgeState {
	if (!isStructureStateChoice(state)) {
		return {
			label: 'Unknown',
			variant: 'secondary',
		}
	}

	return {
		label: STRUCTURE_STATE_LABEL_BY_VALUE[state],
		variant: STRUCTURE_STATE_BADGE_VARIANT_BY_VALUE[state],
	}
}
