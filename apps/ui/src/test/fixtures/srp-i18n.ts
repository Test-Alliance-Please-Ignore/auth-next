import { srpKeys } from '@/features/srp/query-keys'

import type { QueryClient } from '@tanstack/react-query'
import type { SRPRequestResponse } from '@repo/srp'

export const srpRequest: SRPRequestResponse = {
	id: '123456789',
	userId: 'original-user',
	characterId: '90000001',
	characterName: 'Original Pilot',
	corporationId: '98000001',
	corporationName: 'Original Corporation',
	killmailHash: 'original-hash',
	killmailUrl: 'https://zkillboard.com/kill/123456789/',
	lossDate: '2026-09-15T12:00:00Z',
	shipTypeId: '587',
	shipTypeName: 'Rifter',
	shipValue: '125000000',
	srpEquipmentValue: '125000000',
	approvedAmount: '123400000',
	solarSystemName: 'Jita',
	contextText: 'Original context <keep>',
	requestStatus: 'pending',
	characterRole: 'main',
	createdAt: '2026-09-15T13:00:00Z',
	updatedAt: '2026-09-15T13:00:00Z',
	srpItemPrices: [
		{
			typeId: '587',
			typeName: 'Rifter',
			quantity: 1,
			unitPrice: '125000000',
			lineTotal: '125000000',
		},
	],
	killmailItems: [],
	shipSlotCapacities: { high: 1 },
	history: [
		{
			id: 'history-original',
			requestId: '123456789',
			actorUserId: 'original-user',
			actorCharacterName: 'Original Pilot',
			action: 'request_created',
			newRequestStatus: 'pending',
			visibility: 'public',
			timestamp: '2026-09-15T13:00:00Z',
			metadata: { notes: 'Original note <keep>' },
		},
	],
}

export function seedSrpI18nQueries(client: QueryClient) {
	client.setQueryData(['auth', 'session'], {
		authenticated: true,
		user: {
			id: 'original-user',
			mainCharacterId: '90000001',
			is_admin: true,
			characters: [
				{ characterId: '90000001', characterName: 'Original Pilot', hasValidToken: true },
			],
		},
		permissions: [],
	})
	client.setQueryData(srpKeys.config(), {
		id: 'config-original',
		isActive: true,
		defaultCoverageRate: '1',
		maxPayoutAmount: '1234567890',
		maxLossAgeDays: 30,
		predefinedAdhocModifiers: [
			{
				modifierType: 'deduction',
				mode: 'percentage',
				amount: 1.5,
				reason: 'Original template reason',
			},
		],
	})
	client.setQueryData(srpKeys.discordGuilds(), [])
	client.setQueryData(srpKeys.policies(), [
		{
			id: 'policy-original',
			name: 'Original policy',
			effect: 'payout_modifier',
			config: { rate: '0.8', applyInsuranceDelta: true },
			isActive: true,
			displayOrder: 1,
		},
	])
	client.setQueryData(srpKeys.doctrineFittingsByShip('587'), [
		{
			id: 'fitting-original',
			name: 'Original doctrine',
			fittingItems: [{ typeId: '7001', typeName: 'Original Module', flagId: '27', quantity: '1' }],
		},
	])
	client.setQueryData(srpKeys.request(srpRequest.id), srpRequest)
	for (const internal of [false, true])
		client.setQueryData(srpKeys.comments(srpRequest.id, internal), [
			{
				id: 'comment-original',
				requestId: srpRequest.id,
				authorUserId: 'original-user',
				authorCharacterName: 'Original Pilot',
				authorRole: 'staff',
				authorCharacterRole: 'main',
				content: 'Original comment <keep>',
				visibility: 'public',
				isEdited: true,
				createdAt: '2026-09-15T13:00:00Z',
			},
		])
	const losses = [
		{
			killmailId: '987654321',
			killmailHash: 'original-loss-hash',
			victimCharacterId: '90000001',
			victimCharacterName: 'Original Pilot',
			shipTypeId: '587',
			shipTypeName: 'Rifter',
			killmailTime: '2026-09-15T12:00:00Z',
			solarSystemName: 'Jita',
			hasSRPRequest: false,
			victimItems: [],
		},
	]
	for (const params of [{}, { limit: 10, offset: 0 }])
		client.setQueryData(srpKeys.losses(params), {
			losses,
			total: 1,
			limit: 10,
			offset: 0,
			failedCharacters: [],
		})
	client.setQueryData(['srp', 'killmail-preview', '987654321', 'original-loss-hash', '90000001'], {
		victimItems: [],
		itemPrices: [],
		itemNames: {},
	})
	client.setQueryData(srpKeys.lossRefreshStatus(), { status: null, cooldownUntil: null })
	client.setQueryData(srpKeys.myRequests({ limit: 10, offset: 0 }), {
		requests: [srpRequest],
		total: 1,
		limit: 10,
		offset: 0,
	})
	client.setQueryData(
		['srp', 'requests', 'review-by-status', 'pending', 25, 0, '', '', '', '', ''],
		{
			requests: [srpRequest],
			total: 1,
			limit: 25,
			offset: 0,
		}
	)
	client.setQueryData(srpKeys.pendingPayments({ limit: 100 }), {
		requests: [{ ...srpRequest, requestStatus: 'approved' }],
		total: 1,
	})
	client.setQueryData(srpKeys.pendingPayoutTotal({}), { pendingPayoutTotal: '123400000' })
	client.setQueryData(
		srpKeys.paymentAlerts({ includeAcknowledged: false, limit: 100, offset: 0 }),
		{
			alerts: [
				{
					id: 'alert-original',
					requestId: srpRequest.id,
					kind: 'payment_mismatch',
					state: 'open',
					journalId: '111111111',
					expectedAmount: '123400000',
					observedAmount: '100000000',
					expectedRecipientCharacterId: '90000001',
					expectedRecipientCharacterName: 'Original Pilot',
					detectedAt: '2026-09-15T14:00:00Z',
				},
			],
			total: 1,
		}
	)
	client.setQueryData(srpKeys.walletHistory({ limit: 50, offset: 0 }), {
		items: [
			{
				journalId: '111111111',
				entryDate: '2026-09-15T14:00:00Z',
				amount: '100000000',
				reason: 'SRP - KM#123456789',
				recipientId: '90000001',
				recipientName: 'Original Pilot',
				linkedRequestId: srpRequest.id,
				hasMissingReasonWarning: true,
			},
		],
		total: 1,
	})
}
