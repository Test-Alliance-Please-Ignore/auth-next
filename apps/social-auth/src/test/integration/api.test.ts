import { env as testEnv } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import type { SessionStore } from '@repo/session-store'
import type { Env } from '../../context'

const env = testEnv as Env

describe('SessionStore - Account Linking', () => {
	it('should create an account link', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global')

		// Create social user first
		const socialUser = await stub.getOrCreateSocialUser(
			'google',
			'google-user-123',
			'test@example.com',
			'Test User'
		)

		const link = await stub.createAccountLink(
			socialUser.socialUserId,
			'test-auth',
			'legacy-user-456',
			'testuser',
			false,
			false,
			false,
			'',
			'',
			[]
		)

		expect(link.linkId).toBeDefined()
		expect(link.socialUserId).toBe(socialUser.socialUserId)
		expect(link.legacySystem).toBe('test-auth')
		expect(link.legacyUserId).toBe('legacy-user-456')
		expect(link.legacyUsername).toBe('testuser')
		expect(link.linkedAt).toBeGreaterThan(0)
		expect(link.updatedAt).toBeGreaterThan(0)
	})

	it('should retrieve account links by social user', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global-2')

		// Create social user
		const socialUser = await stub.getOrCreateSocialUser(
			'google',
			'google-user-789',
			'test2@example.com',
			'Test User 2'
		)

		// Create a link
		await stub.createAccountLink(
			socialUser.socialUserId,
			'test-auth',
			'legacy-user-101',
			'user1',
			false,
			false,
			false,
			'',
			'',
			[]
		)

		// Retrieve links
		const links = await stub.getAccountLinksBySocialUser(socialUser.socialUserId)

		expect(links).toHaveLength(1)
		expect(links[0].socialUserId).toBe(socialUser.socialUserId)
		expect(links[0].legacyUserId).toBe('legacy-user-101')
		expect(links[0].legacyUsername).toBe('user1')
	})

	it('should prevent duplicate legacy account claims', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global-3')

		// Create first social user and link
		const socialUser1 = await stub.getOrCreateSocialUser(
			'google',
			'google-user-aaa',
			'test3a@example.com',
			'Test User 3A'
		)
		await stub.createAccountLink(
			socialUser1.socialUserId,
			'test-auth',
			'legacy-user-200',
			'userA',
			false,
			false,
			false,
			'',
			'',
			[]
		)

		// Create second social user and try to claim same legacy account
		const socialUser2 = await stub.getOrCreateSocialUser(
			'google',
			'google-user-bbb',
			'test3b@example.com',
			'Test User 3B'
		)

		await expect(
			stub.createAccountLink(
				socialUser2.socialUserId,
				'test-auth',
				'legacy-user-200',
				'userA',
				false,
				false,
				false,
				'',
				'',
				[]
			)
		).rejects.toThrow('This legacy account is already claimed by another user')
	})

	it('should retrieve account link by legacy user ID', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global-4')

		// Create social user and link
		const socialUser = await stub.getOrCreateSocialUser(
			'google',
			'google-user-ccc',
			'test4@example.com',
			'Test User 4'
		)
		await stub.createAccountLink(
			socialUser.socialUserId,
			'test-auth',
			'legacy-user-300',
			'userC',
			false,
			false,
			false,
			'',
			'',
			[]
		)

		// Retrieve by legacy ID
		const link = await stub.getAccountLinkByLegacyId('test-auth', 'legacy-user-300')

		expect(link).not.toBeNull()
		expect(link?.legacyUserId).toBe('legacy-user-300')
		expect(link?.socialUserId).toBe(socialUser.socialUserId)
	})

	it('should return null for non-existent legacy account link', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global-5')

		const link = await stub.getAccountLinkByLegacyId('test-auth', 'non-existent-user')

		expect(link).toBeNull()
	})

	it('should delete account link', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global-6')

		// Create social user and link
		const socialUser = await stub.getOrCreateSocialUser(
			'google',
			'google-user-ddd',
			'test6@example.com',
			'Test User 6'
		)
		const link = await stub.createAccountLink(
			socialUser.socialUserId,
			'test-auth',
			'legacy-user-400',
			'userD',
			false,
			false,
			false,
			'',
			'',
			[]
		)

		// Delete the link
		await stub.deleteAccountLink(link.linkId)

		// Verify it's deleted
		const links = await stub.getAccountLinksBySocialUser(socialUser.socialUserId)
		expect(links).toHaveLength(0)
	})

	it('should fail to delete non-existent account link', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-global-7')

		await expect(stub.deleteAccountLink('non-existent-link-id')).rejects.toThrow(
			'Account link not found'
		)
	})
})

describe('SessionStore - OIDC State Management', () => {
	it('should create OIDC state', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-oidc-1')

		const state = await stub.createOIDCState('session-123')

		expect(state).toBeDefined()
		expect(state).toHaveLength(64) // 32 bytes * 2 (hex)
	})

	it('should validate OIDC state and return session ID', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-oidc-2')

		// Create state
		const state = await stub.createOIDCState('session-456')

		// Validate state
		const sessionId = await stub.validateOIDCState(state)

		expect(sessionId).toBe('session-456')
	})

	it('should fail to validate invalid OIDC state', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-oidc-3')

		await expect(stub.validateOIDCState('invalid-state')).rejects.toThrow(
			'Invalid or expired state'
		)
	})

	it('should consume OIDC state after validation (one-time use)', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-oidc-4')

		// Create state
		const state = await stub.createOIDCState('session-789')

		// Validate once - should work
		await stub.validateOIDCState(state)

		// Try to validate again - should fail
		await expect(stub.validateOIDCState(state)).rejects.toThrow('Invalid or expired state')
	})
})

describe('Account Linking Integration', () => {
	it('should prevent multiple links for same social account (1:1 constraint)', async () => {
		const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-integration-1')

		// Create social user
		const socialUser = await stub.getOrCreateSocialUser(
			'google',
			'google-user-eee',
			'test-int1@example.com',
			'Test User Int 1'
		)

		// Create initial link
		await stub.createAccountLink(
			socialUser.socialUserId,
			'test-auth',
			'legacy-user-500',
			'userE',
			false,
			false,
			false,
			'',
			'',
			[]
		)

		// Same social user tries to claim different legacy account - should fail
		await expect(
			stub.createAccountLink(
				socialUser.socialUserId,
				'test-auth',
				'legacy-user-501',
				'userE2',
				false,
				false,
				false,
				'',
				'',
				[]
			)
		).rejects.toThrow(/already linked a legacy account/)
	})
})
