export const MAX_PERSONAL_BROADCAST_TEMPLATES = 6

export interface PersonalBroadcastTemplateInput {
	name: string
	targetId: string
	templateId: string | null
	content: Record<string, string>
}

export interface PersonalBroadcastTemplate extends PersonalBroadcastTemplateInput {
	id: string
}

/** Retain reusable composer values, never per-broadcast delivery metadata or SRP tokens. */
export function getPersonalBroadcastTemplateContent(
	content: Record<string, unknown>,
	fieldNames: string[]
): Record<string, string> {
	const allowed = new Set([
		...fieldNames.filter((name) => !name.startsWith('__')),
		'mentionLevel',
		'__prefixText',
		'__defaultText',
		'__doctrineId',
		'__fleetTrackingCharacterId',
		'__fleetTrackingCharacterName',
		'__fleetTrackingEnabled',
		'__frogsirenEnabled',
	])
	return Object.fromEntries(
		Object.entries(content).filter(([key, value]) => allowed.has(key) && typeof value === 'string')
	) as Record<string, string>
}

export function isPersonalBroadcastTemplateInput(
	value: unknown
): value is PersonalBroadcastTemplateInput {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const data = value as Record<string, unknown>
	return (
		typeof data.name === 'string' &&
		data.name.trim().length > 0 &&
		data.name.length <= 80 &&
		typeof data.targetId === 'string' &&
		data.targetId.length > 0 &&
		data.targetId.length <= 128 &&
		(data.templateId === null ||
			(typeof data.templateId === 'string' &&
				data.templateId.length > 0 &&
				data.templateId.length <= 128)) &&
		data.content !== null &&
		typeof data.content === 'object' &&
		!Array.isArray(data.content) &&
		Object.keys(data.content).length <= 100 &&
		Object.entries(data.content).every(
			([key, field]) => key.length <= 128 && typeof field === 'string' && field.length <= 4000
		) &&
		JSON.stringify(data.content).length <= 24000
	)
}
