import { describe, expect, it } from 'vitest'

import { getThirdPartyAppScopeMetadata } from '@repo/admin'

import {
	getThirdPartyAppScopeAccessLevel,
	groupThirdPartyAppScopeOptions,
} from '@/routes/admin/third-party-apps.helpers'

describe('third-party app scope helpers', () => {
	it('groups auth platform and esi proxy scopes separately', () => {
		const groups = groupThirdPartyAppScopeOptions([
			getThirdPartyAppScopeMetadata('profile'),
			getThirdPartyAppScopeMetadata('permissions'),
			getThirdPartyAppScopeMetadata('esi:esi-assets.read_assets.v1'),
			getThirdPartyAppScopeMetadata('esi:esi-assets.write_assets.v1'),
			getThirdPartyAppScopeMetadata('esi:esi-wallet.read_character_wallet.v1'),
		])

		expect(groups).toHaveLength(2)
		expect(groups[0]).toEqual(
			expect.objectContaining({
				key: 'auth-platform',
				label: 'Auth Platform Scopes',
				scopes: expect.arrayContaining([
					expect.objectContaining({ scope: 'profile', accessLevel: 'read' }),
					expect.objectContaining({ scope: 'permissions', accessLevel: 'read' }),
				]),
			})
		)
		expect(groups[1]).toEqual(
			expect.objectContaining({
				key: 'esi-proxy',
				label: 'ESI Proxy Scopes',
				domainGroups: expect.arrayContaining([
					expect.objectContaining({
						key: 'assets',
						label: 'Assets',
						scopes: expect.arrayContaining([
							expect.objectContaining({
								scope: 'esi:esi-assets.read_assets.v1',
								accessLevel: 'read',
							}),
							expect.objectContaining({
								scope: 'esi:esi-assets.write_assets.v1',
								accessLevel: 'write',
							}),
						]),
					}),
					expect.objectContaining({
						key: 'wallet',
						label: 'Wallet',
						scopes: expect.arrayContaining([
							expect.objectContaining({
								scope: 'esi:esi-wallet.read_character_wallet.v1',
								accessLevel: 'read',
							}),
						]),
					}),
				]),
			})
		)
	})

	it('treats non-esi scopes as read access', () => {
		expect(getThirdPartyAppScopeAccessLevel('profile')).toBe('read')
		expect(getThirdPartyAppScopeAccessLevel('groups')).toBe('read')
		expect(getThirdPartyAppScopeAccessLevel('esi:esi-mail.send_mail.v1')).toBe('write')
		expect(getThirdPartyAppScopeAccessLevel('esi:esi-wallet.read_character_wallet.v1')).toBe('read')
	})
})
