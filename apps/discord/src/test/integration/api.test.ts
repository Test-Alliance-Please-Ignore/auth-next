import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Discord } from '@repo/discord'
import type { Env } from '../../context'

// Cast env to have correct types
const testEnv = env as unknown as Env

describe('Discord Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toBe('Discord Durable Object Worker')
	})

	it('returns 404 for non-existent profile', async () => {
		const request = new Request(
			'http://example.com/discord/profile/550e8400-e29b-41d4-a716-446655440000'
		)
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

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
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

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
		const response = await worker.fetch(request, testEnv, ctx)
		await waitOnExecutionContext(ctx)

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

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signDiscordInteractionPayload(payload: unknown): Promise<{
	rawBody: string
	timestamp: string
	signatureHex: string
	publicKeyHex: string
}> {
	const rawBody = JSON.stringify(payload)
	const timestamp = String(Math.floor(Date.now() / 1000))
	const bodyWithTimestamp = new TextEncoder().encode(`${timestamp}${rawBody}`)
	const keyPair = (await crypto.subtle.generateKey(
		{ name: 'Ed25519' },
		true,
		['sign', 'verify']
	)) as CryptoKeyPair
	const signature = await crypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, bodyWithTimestamp)
	const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey)
	if (!(publicKey instanceof ArrayBuffer)) {
		throw new Error('Expected raw public key as ArrayBuffer')
	}

	return {
		rawBody,
		timestamp,
		signatureHex: bytesToHex(new Uint8Array(signature)),
		publicKeyHex: bytesToHex(new Uint8Array(publicKey)),
	}
}
