import { describe, expect, it } from 'vitest'

import { buildAuthSessionResponse } from '../auth'

describe('/auth/session response shaping', () => {
	it('preserves resolved structure permissions in the session payload', () => {
		const response = buildAuthSessionResponse(
			{
				id: 'user-1',
				mainCharacterId: '7001',
				characters: [],
				is_admin: false,
				roles: ['urn:service:core:role:alliance-member'],
				discord: null as never,
				legacyAuth: {
					userId: null,
					username: null,
					isLinked: false,
				},
			},
			[
				{
					permissionId: 'perm-structure-viewer',
					urn: 'urn:structures:all:viewer',
					name: 'Structures Viewer',
					description: 'Can view all structures',
				},
				{
					permissionId: null,
					urn: 'urn:structures:corp-1:manager',
					name: 'Corp Manager',
					description: null,
				},
			]
		)

		expect(response).toEqual({
			authenticated: true,
			user: {
				id: 'user-1',
				mainCharacterId: '7001',
				characters: [],
				is_admin: false,
				roles: ['urn:service:core:role:alliance-member'],
				discord: null,
				legacyAuth: {
					userId: null,
					username: null,
					isLinked: false,
				},
			},
			permissions: [
				{
					permissionId: 'perm-structure-viewer',
					urn: 'urn:structures:all:viewer',
					name: 'Structures Viewer',
					description: 'Can view all structures',
				},
				{
					permissionId: null,
					urn: 'urn:structures:corp-1:manager',
					name: 'Corp Manager',
					description: null,
				},
			],
		})
	})

	it('returns the unauthenticated shape when there is no user', () => {
		expect(buildAuthSessionResponse(null)).toEqual({
			authenticated: false,
			user: null,
			permissions: [],
		})
	})
})
