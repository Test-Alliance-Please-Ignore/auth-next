import { composerFields, composerTemplate } from './broadcast-composer'
import { broadcastTarget } from './broadcasts'

import type { PersonalBroadcastTemplate } from '@repo/broadcasts'

export const personalBroadcastTemplate: PersonalBroadcastTemplate = {
	id: 'personal-original',
	name: 'My fleet template',
	targetId: broadcastTarget.id,
	templateId: composerTemplate.id,
	content: {
		...Object.fromEntries(Object.entries(composerFields).filter(([key]) => key !== '__srpToken')),
		notes: 'Saved personal notes',
		__prefixText: 'Saved before',
		__defaultText: 'Saved after',
		mentionLevel: 'none',
	},
}
