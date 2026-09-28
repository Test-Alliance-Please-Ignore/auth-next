import type { BroadcastTarget, BroadcastTemplate } from '@/lib/api'

export function canUseTemplateForTarget(template: BroadcastTemplate, target: BroadcastTarget) {
	return template.targetType === target.type && template.targetIds.includes(target.id)
}
