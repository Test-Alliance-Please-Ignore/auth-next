import type { CreateBroadcastTemplateRequest } from '@/lib/api'

type FieldSchemaEntry = CreateBroadcastTemplateRequest['fieldSchema'][number]

export interface BroadcastSystemTemplateTokenDefinition {
	name: 'doctrine' | 'staging' | 'srp' | 'fleetName' | 'fleetCommander'
	label: string
	fieldType: FieldSchemaEntry['type']
	required: boolean
	allowCustom?: boolean
	tagSyntax: string
	description: string
	renderBehavior: string
}

export const BROADCAST_SYSTEM_TEMPLATE_TOKENS: BroadcastSystemTemplateTokenDefinition[] = [
	{
		name: 'doctrine',
		label: 'Doctrine',
		fieldType: 'system_doctrine',
		required: true,
		allowCustom: true,
		tagSyntax: '{{<doctrine>}}',
		description: 'Searchable doctrine selector with Read MOTD and Custom options.',
		renderBehavior: 'Renders the selected doctrine name or custom text.',
	},
	{
		name: 'staging',
		label: 'Staging',
		fieldType: 'system_staging',
		required: true,
		allowCustom: true,
		tagSyntax: '{{<staging>}}',
		description: 'Searchable staging-system selector with a Custom override.',
		renderBehavior: 'Renders the selected staging system name or custom text.',
	},
	{
		name: 'srp',
		label: 'SRP Enabled',
		fieldType: 'system_srp',
		required: true,
		tagSyntax: '{{<srp>}}',
		description: 'Select SRP type for the broadcast message.',
		renderBehavior:
			'Renders "SRP: **Blanket|Military|Coalition|No**". Non-"No" modes include an SRP token line.',
	},
	{
		name: 'fleetName',
		label: 'Fleet Name',
		fieldType: 'system_fleet_name',
		required: true,
		tagSyntax: '{{<fleetName>}}',
		description: 'Fleet name used in the rendered message and as tracking session name.',
		renderBehavior: 'Renders the fleet name text value.',
	},
	{
		name: 'fleetCommander',
		label: 'Fleet Commander',
		fieldType: 'system_fleet_commander',
		required: true,
		allowCustom: true,
		tagSyntax: '{{<fleetCommander>}}',
		description: 'Searchable character selector with optional custom text fallback.',
		renderBehavior:
			'Renders selected character name or custom text. Fleet tracking requires a valid character selection.',
	},
]

export function getBroadcastSystemTemplateToken(
	name: string
): BroadcastSystemTemplateTokenDefinition | undefined {
	return BROADCAST_SYSTEM_TEMPLATE_TOKENS.find((token) => token.name === name)
}
