import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Discord } from '@repo/discord'
import type { Env } from '../../context'

vi.mock('@repo/hono-helpers', () => ({
	logger: {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
	withOnError: () => () => new Response('Internal Server Error', { status: 500 }),
	withNotFound: () => (c: any) => c.json({ error: 'Not Found' }, 404),
	withSentry: <T>(app: T) => app,
	withWorkersLogger: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('Discord Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toBe('Discord Durable Object Worker')
	})

	it.skip('returns 404 for non-existent profile without a configured test database', async () => {
		const request = new Request(
			'http://example.com/discord/profile/550e8400-e29b-41d4-a716-446655440000'
		)
		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(404)
		const data = (await response.json()) as { error: string }
		expect(data).toHaveProperty('error')
	})

	it('rejects interactions with missing signature headers', async () => {
		const request = new Request('http://example.com/api/discord/interactions', {
			method: 'POST',
			body: JSON.stringify({ type: 1 }),
		})
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(401)
	})

	it('accepts signed ping interactions', async () => {
		const payload = { id: 'ping-1', type: 1 }
		const signed = await signDynamicDiscordInteractionPayload(payload)
		testEnv.DISCORD_PUBLIC_KEY = signed.publicKeyHex

		const request = new Request('http://example.com/api/discord/interactions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Signature-Ed25519': signed.signatureHex,
				'X-Signature-Timestamp': signed.timestamp,
			},
			body: signed.rawBody,
		})

		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({ type: 1 })
	})

	it('rejects signed interactions when the public key is not configured', async () => {
		const payload = { id: 'ping-1', type: 1 }
		const signed = await signDynamicDiscordInteractionPayload(payload)
		Reflect.deleteProperty(testEnv as object, 'DISCORD_PUBLIC_KEY')

		const request = new Request('http://example.com/api/discord/interactions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Signature-Ed25519': signed.signatureHex,
				'X-Signature-Timestamp': signed.timestamp,
			},
			body: signed.rawBody,
		})

		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(401)
	})

	it('executes signed slash commands via core binding', async () => {
		const executeDiscordSlashCommand = vi.fn().mockResolvedValue({
			ok: true,
			response: {
				type: 4,
				data: {
					content: 'Command response from core',
					flags: 64,
				},
			},
			coreUserId: 'user-1',
			authorized: true,
			commandId: 'command-1',
			reason: 'ok',
		})

		testEnv.CORE = {
			getDiscordInteractionRouting: vi.fn().mockResolvedValue({ commands: {} }),
			executeDiscordSlashCommand,
		} as any

		const payload = {
			id: 'interaction-1',
			type: 2,
			guild_id: 'guild-1',
			channel_id: 'channel-1',
			member: { user: { id: 'discord-user-1' } },
			data: {
				name: 'status',
				options: [{ name: 'target', value: 'eve' }],
			},
		}
		const signed = await signDynamicDiscordInteractionPayload(payload)
		testEnv.DISCORD_PUBLIC_KEY = signed.publicKeyHex

		const request = new Request('http://example.com/api/discord/interactions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Signature-Ed25519': signed.signatureHex,
				'X-Signature-Timestamp': signed.timestamp,
			},
			body: signed.rawBody,
		})

		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			type: 4,
			data: {
				content: 'Command response from core',
				flags: 64,
			},
		})
		expect(executeDiscordSlashCommand).toHaveBeenCalledWith({
			commandName: 'status',
			discordUserId: 'discord-user-1',
			guildId: 'guild-1',
			channelId: 'channel-1',
			memberRoleIds: [],
			options: [{ name: 'target', value: 'eve' }],
			interactionId: 'interaction-1',
		})
	})

	it('forwards labeled modal select values to core', async () => {
		const executeDiscordModalSubmit = vi.fn().mockResolvedValue({
			ok: true,
			response: {
				type: 4,
				data: { content: 'Role updated', flags: 64 },
			},
			coreUserId: 'user-1',
			reason: 'ok',
		})

		testEnv.CORE = { executeDiscordModalSubmit } as any
		const payload = {
			id: 'modal-1',
			type: 5,
			guild_id: 'guild-1',
			channel_id: 'channel-1',
			member: { user: { id: 'discord-user-1' } },
			data: {
				custom_id: 'tmp-role:join',
				components: [
					{
						type: 18,
						component: {
							type: 3,
							custom_id: 'tmp-role:join:role',
							values: ['role-db-id'],
						},
					},
				],
			},
		}
		const signed = await signDynamicDiscordInteractionPayload(payload)
		testEnv.DISCORD_PUBLIC_KEY = signed.publicKeyHex

		const request = new Request('http://example.com/api/discord/interactions', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Signature-Ed25519': signed.signatureHex,
				'X-Signature-Timestamp': signed.timestamp,
			},
			body: signed.rawBody,
		})

		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual({
			type: 4,
			data: { content: 'Role updated', flags: 64 },
		})
		expect(executeDiscordModalSubmit).toHaveBeenCalledWith({
			customId: 'tmp-role:join',
			fields: {},
			selectValues: { 'tmp-role:join:role': ['role-db-id'] },
			discordUserId: 'discord-user-1',
			interactionId: 'modal-1',
			guildId: 'guild-1',
			channelId: 'channel-1',
			values: ['role-db-id'],
		})
	})
})

describe('Discord Durable Object', () => {
	it.skip('returns null for non-existent profile', async () => {
		const stub = getStub<Discord>(testEnv.DISCORD, 'default')

		const profile = await stub.getProfileByCoreUserId('550e8400-e29b-41d4-a716-446655440000')

		expect(profile).toBeNull()
	})

	it.skip('can call refreshTokenByCoreUserId', async () => {
		const stub = getStub<Discord>(testEnv.DISCORD, 'default')

		const result = await stub.refreshTokenByCoreUserId('550e8400-e29b-41d4-a716-446655440000')

		// Should return false since no profile exists
		expect(typeof result).toBe('boolean')
		expect(result).toBe(false)
	})
})

async function signDynamicDiscordInteractionPayload(payload: unknown): Promise<{
	rawBody: string
	timestamp: string
	signatureHex: string
	publicKeyHex: string
}> {
	const rawBody = JSON.stringify(payload)
	const timestamp = Math.floor(Date.now() / 1000).toString()
	const keyPair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
		'sign',
		'verify',
	])) as CryptoKeyPair
	const signature = await crypto.subtle.sign(
		{ name: 'Ed25519' },
		keyPair.privateKey,
		new TextEncoder().encode(`${timestamp}${rawBody}`)
	)
	const publicKey = (await crypto.subtle.exportKey('raw', keyPair.publicKey)) as ArrayBuffer
	const toHex = (bytes: ArrayBuffer) =>
		Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')

	return {
		rawBody,
		timestamp,
		signatureHex: toHex(signature),
		publicKeyHex: toHex(publicKey),
	}
}

async function fetchDiscordWorker(
	request: Request,
	env: Env,
	ctx: ReturnType<typeof createExecutionContext>
): Promise<Response> {
	try {
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)
		return response
	} catch (error) {
		throw new Error(
			`Discord worker request failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
		)
	}
}
