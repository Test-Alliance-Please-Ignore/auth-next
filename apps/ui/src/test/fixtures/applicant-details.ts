import { applicant, application } from './applicant-workflows'

import type {
	Application,
	ApplicationActivityLogEntry,
	ApplicationMessage,
} from '@/features/applications/api'
import type { CorporationScopedAccessResult } from '@/features/corporations/api'
import type { User } from '@/hooks/useAuth'

export const detailApplicant: User = {
	...applicant,
	characters: [
		...applicant.characters,
		{ characterId: '345678912', characterName: 'Extra <Alt>', hasValidToken: true },
	],
}

export const activity: ApplicationActivityLogEntry[] = [
	{
		id: 'submitted-event',
		applicationId: application.id,
		action: 'submitted',
		timestamp: '2026-09-14T02:00:00Z',
	},
	{
		id: 'status-event',
		applicationId: application.id,
		action: 'status_changed',
		previousValue: 'pending',
		newValue: 'under_review',
		characterId: '987654321',
		characterName: 'Reviewer <Pilot>',
		metadata: { reviewNotes: 'Original <review> text' },
		timestamp: '2026-09-14T03:00:00Z',
	},
	{
		id: 'alt-event',
		applicationId: application.id,
		action: 'alt_added',
		newValue: applicant.characters[1].characterId,
		metadata: { altCharacterName: applicant.characters[1].characterName },
		timestamp: '2026-09-14T04:00:00Z',
	},
]

export const detailedApplication: Application = {
	...application,
	applicationText: 'Original <application> text — 지원 내용',
	altCharacterIds: application.altCharacters!.map(({ characterId }) => characterId),
	activityLog: activity,
	recommendations: [],
	messageCount: 2,
}

export const messages: ApplicationMessage[] = [
	{
		id: 'received-original',
		applicationId: application.id,
		senderId: 'reviewer-original',
		senderCharacterId: '987654321',
		senderCharacterName: 'Reviewer <Pilot>',
		recipientId: applicant.id,
		message: 'Original received <message>',
		createdAt: '2026-09-14T03:00:00Z',
	},
	{
		id: 'sent-original',
		applicationId: application.id,
		senderId: applicant.id,
		senderCharacterId: applicant.mainCharacterId,
		senderCharacterName: applicant.characters[0].characterName,
		recipientId: 'reviewer-original',
		message: 'Original sent <message> — 안녕하세요',
		createdAt: '2026-09-14T04:00:00Z',
	},
]

export const corporationAccess: CorporationScopedAccessResult = {
	hasAccess: false,
	userRole: null,
	hrRole: null,
	corporation: {
		corporationId: application.corporationId,
		name: application.corporationName!,
		ticker: 'ORIG',
		isMemberCorporation: true,
		isAltCorp: false,
		isSpecialPurpose: false,
	},
}
