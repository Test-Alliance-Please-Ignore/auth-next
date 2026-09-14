import { MUMBLE_ALLIANCE_MEMBER_ROLE } from '@/features/mumble/access'

import { applicant } from './applicant-workflows'

import type { MumbleAccountStatus, MumbleOneTimeCredentials } from '@/features/mumble/types'
import type { User } from '@/hooks/useAuth'
import type { TempopListResponse, UserPermission } from '@/lib/api'

export const mumbleMember: User = { ...applicant, roles: [MUMBLE_ALLIANCE_MEMBER_ROLE] }
export const mumbleAccount: MumbleAccountStatus = {
	subjectId: applicant.id,
	loginName: 'Original <Pilot>',
	displayName: 'Original <Pilot>',
	enabled: true,
	groups: ['Original <Group>', 'TempOp'],
	hasPassword: true,
	lastAuthenticatedAt: '2026-09-14T09:00:00Z',
}
// Deliberately synthetic values to verify that localized labels never change protocol/clipboard data.
export const mumbleCredentials: MumbleOneTimeCredentials = {
	loginName: mumbleAccount.loginName,
	password: 'Fixture/@:? &비밀',
	connection: { host: 'voice.example.test', port: 64738 },
}
export const tempopPermissions: UserPermission[] = [
	'urn:mumble:tempop:create',
	'urn:mumble:tempop:delete',
].map((urn) => ({
	urn,
	name: urn,
	description: null,
	category: null,
	groupId: 'original-group',
	groupName: 'Original <Group>',
	targetType: 'all_members',
	source: 'global',
}))
export const tempopList: TempopListResponse = {
	items: [
		{
			id: 'tempop-original',
			shortCode: 'CODE1',
			creatorUserId: mumbleMember.id,
			creatorName: 'Original <Creator>',
			groupName: 'TempOp',
			ttlSeconds: 14400,
			status: 'active',
			guestCount: 1234,
			createdAt: '2026-09-14T08:00:00Z',
			expiresAt: '2026-09-14T12:30:00Z',
			deletedAt: null,
			canDelete: true,
		},
	],
	creators: [{ id: mumbleMember.id, name: 'Original <Creator>' }],
	pagination: {
		page: 1,
		pageSize: 25,
		totalCount: 30,
		totalPages: 2,
		hasNextPage: true,
		hasPreviousPage: false,
	},
}
