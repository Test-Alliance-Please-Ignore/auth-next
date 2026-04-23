export type BroadcastSystemTemplateFieldType = 'system_doctrine' | 'system_staging' | 'system_srp'

export interface BroadcastSystemTemplateTokenDefinition {
	name: 'doctrine' | 'staging' | 'srp'
	label: string
	fieldType: BroadcastSystemTemplateFieldType
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
]

export const BROADCAST_SYSTEM_TEMPLATE_TOKEN_NAMES = new Set(
	BROADCAST_SYSTEM_TEMPLATE_TOKENS.map((token) => token.name)
)

export function getBroadcastSystemTemplateToken(
	name: string
): BroadcastSystemTemplateTokenDefinition | undefined {
	return BROADCAST_SYSTEM_TEMPLATE_TOKENS.find((token) => token.name === name)
}
