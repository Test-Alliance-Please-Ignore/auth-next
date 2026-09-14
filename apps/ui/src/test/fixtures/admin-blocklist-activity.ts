import type {
	AdminActivityLog,
	BlacklistEntry,
	BlacklistTargetType,
	PaginatedResponse,
} from '@/lib/api'

export const blocklistEntry: BlacklistEntry = {
	id: 'block-original',
	targetType: 'character_name',
	targetValue: 'Character <Original>',
	reason: 'Original reason <detail> {{raw}}',
	blacklistedBy: 'admin-original',
	triggeredBy: 'trigger-original',
	isAutoBlacklist: true,
	metadata: null,
	createdAt: '2026-02-03T12:34:56Z',
}

export const blocklistTargetTypes: BlacklistTargetType[] = [
	'user',
	'character_id',
	'character_name',
	'discord_id',
	'corporation_id',
	'corporation_name',
	'alliance_id',
	'alliance_name',
]

export const blocklistPage: PaginatedResponse<BlacklistEntry> = {
	data: blocklistTargetTypes.map((targetType, index) => ({
		...blocklistEntry,
		id: `block-${targetType}`,
		targetType,
		targetValue:
			targetType === 'user'
				? 'user-original'
				: targetType.endsWith('_id')
					? '987654321012345678'
					: `${targetType} <Original>`,
		isAutoBlacklist: index % 2 === 0,
	})),
	pagination: { page: 1, pageSize: 50, totalCount: 1234, totalPages: 25 },
}

export const activityEntry: AdminActivityLog = {
	id: 'activity-original',
	userId: 'user-original',
	characterId: '987654321',
	action: 'character_linked',
	metadata: {
		originalKey: 'Original <text> {{raw}}',
		amount: 1234.5,
		enabled: true,
		absent: null,
		items: ['Original item'],
	},
	ipAddress: '192.0.2.123',
	userAgent: 'Original Agent/1.2',
	createdAt: '2026-02-03T12:34:56Z',
	characterName: 'Character <Original>',
	userName: 'User <Original>',
}

export const activityPage: PaginatedResponse<AdminActivityLog> = {
	data: [
		activityEntry,
		{ ...activityEntry, id: 'activity-custom', action: 'custom.original_action' },
	],
	pagination: { page: 1, pageSize: 50, totalCount: 1234, totalPages: 25 },
}
