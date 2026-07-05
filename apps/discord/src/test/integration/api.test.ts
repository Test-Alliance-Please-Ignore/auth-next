import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

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
}))

import worker from '../../index'

import type { Discord } from '@repo/discord'
import type { Env } from '../../context'

// Cast env to have correct types
const testEnv = env as unknown as Env
const FIXED_TIMESTAMP = '1710000000'
const FIXED_PUBLIC_KEY_HEX = 'bf6d7e6c953b0d1cb09c300e5a53493d9bcb013d1475a45bd34245236c3ddb7b'
const FIXED_SIGNATURES = new Map<string, string>([
	[
		JSON.stringify({ id: 'ping-1', type: 1 }),
		'9245ba865f75e1876a1bf5e0390936f2d6a936f2af673bda84395a2fdb0c96442a4b61baa65cd275ad613b0085d92dc89def1255ec0fbe55fffbf3cadafd0507',
	],
	[
		JSON.stringify({
			id: 'interaction-1',
			type: 2,
			guild_id: 'guild-1',
			channel_id: 'channel-1',
			member: { user: { id: 'discord-user-1' } },
			data: {
				name: 'status',
				options: [{ name: 'target', value: 'eve' }],
			},
		}),
		'0ca7609e54ccf88f5f9c4631d14766997a3a458ea06bd3d345af7604730accf91ed24fc1b2403d79199aa8401978ad16bddaa610e222d5e05caf4c362ae2fb07',
	],
])

describe('Discord Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await fetchDiscordWorker(request, testEnv, ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toBe('Discord Durable Object Worker')
	})

	it('returns 404 for non-existent profile', async () => {
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
		const signed = await signDiscordInteractionPayload(payload)
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
		const signed = await signDiscordInteractionPayload(payload)
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
			options: [{ name: 'target', value: 'eve' }],
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

async function signDiscordInteractionPayload(payload: unknown): Promise<{
	rawBody: string
	timestamp: string
	signatureHex: string
	publicKeyHex: string
}> {
	const rawBody = JSON.stringify(payload)
	const timestamp = FIXED_TIMESTAMP
	const signatureHex = FIXED_SIGNATURES.get(rawBody)
	if (!signatureHex) {
		throw new Error(`No fixed signature fixture for payload: ${rawBody}`)
	}

	return {
		rawBody,
		timestamp,
		signatureHex,
		publicKeyHex: FIXED_PUBLIC_KEY_HEX,
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
			`Discord worker request failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
		)
	}
}
