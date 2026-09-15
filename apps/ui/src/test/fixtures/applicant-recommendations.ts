import { applicant, application } from './applicant-workflows'

import type { RecommendableApplication, Recommendation } from '@/features/applications/api'

export const recommendation: Recommendation = {
	id: 'recommendation-original',
	applicationId: application.id,
	userId: applicant.id,
	characterId: applicant.mainCharacterId,
	characterName: 'Recommender <Pilot>',
	recommendationText: 'Original <recommendation> text — 추천 내용',
	sentiment: 'positive',
	isPublic: false,
	createdAt: '2026-09-13T10:00:00Z',
	updatedAt: '2026-09-13T10:00:00Z',
}
export const recommendableApplication: RecommendableApplication = {
	id: application.id,
	corporationId: application.corporationId,
	characterId: application.characterId,
	characterName: 'Candidate <Pilot>',
	status: 'pending',
	createdAt: application.createdAt,
	recommendationCount: 1234,
	userHasRecommended: false,
	userRecommendation: null,
}
