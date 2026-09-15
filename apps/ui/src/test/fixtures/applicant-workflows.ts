import type { ApplicationListItem } from '@/features/applications/api'
import type { User } from '@/hooks/useAuth'

export const applicant: User = {
	id: 'applicant-original',
	is_admin: false,
	mainCharacterId: '123456789',
	characters: [
		{ characterId: '123456789', characterName: 'Main <Pilot>', hasValidToken: true },
		{ characterId: '234567891', characterName: 'Alt <Pilot>', hasValidToken: false },
	],
}

export const application: ApplicationListItem = {
	id: 'application-original',
	corporationId: 'corporation-original',
	corporationName: 'Original <Corporation>',
	userId: applicant.id,
	characterId: applicant.mainCharacterId,
	characterName: applicant.characters[0].characterName,
	altCharacters: [applicant.characters[1]],
	status: 'under_review',
	applicationTextPreview: 'Original <application> text — 지원 내용',
	createdAt: '2026-09-13T10:00:00Z',
	updatedAt: '2026-09-13T10:00:00Z',
	recommendationCount: 1234,
	isFirstApplication: true,
}
