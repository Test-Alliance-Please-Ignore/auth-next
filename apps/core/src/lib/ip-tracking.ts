import { sql } from '@repo/db-utils'

import { userIpAddresses } from '../db/schema'

import type { Context } from 'hono'
import type { App } from '../context'
import type { createDb } from '../db'

const encoder = new TextEncoder()

let cachedSecret: string | null = null
let cachedKey: CryptoKey | null = null

function bufferToHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

async function getHmac(secret: string, value: string): Promise<string> {
	if (cachedSecret !== secret || !cachedKey) {
		cachedKey = await crypto.subtle.importKey(
			'raw',
			encoder.encode(secret),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		)
		cachedSecret = secret
	}

	const signature = await crypto.subtle.sign('HMAC', cachedKey, encoder.encode(value))
	return bufferToHex(signature)
}

export function extractClientIp(c: Context<App>): string | null {
	// CF-Connecting-IP is always a single IP set by Cloudflare
	const cfIp = c.req.header('CF-Connecting-IP')
	if (cfIp) {
		return cfIp.trim()
	}

	// X-Forwarded-For can contain multiple comma-separated IPs: "client, proxy1, proxy2"
	// The first IP is the original client IP
	const xff = c.req.header('X-Forwarded-For')
	if (xff) {
		const firstIp = xff.split(',')[0]?.trim()
		if (firstIp) {
			return firstIp
		}
	}

	// X-Real-IP is typically a single IP
	const realIp = c.req.header('X-Real-IP')
	if (realIp) {
		return realIp.trim()
	}

	return null
}

export interface RecordUserIpAddressOptions {
	db: ReturnType<typeof createDb>
	userId: string
	ip: string
	hashSecret: string
	now?: Date
}

export async function recordUserIpAddress({
	db,
	userId,
	ip,
	hashSecret,
	now = new Date(),
}: RecordUserIpAddressOptions): Promise<void> {
	if (!ip || !hashSecret) {
		return
	}

	const ipAddress = ip.trim()
	if (!ipAddress) {
		return
	}

	const ipAddressHash = await getHmac(hashSecret, ipAddress)

	// Atomic upsert with conditional lastSeenAt update (respects 15-min rate limit)
	await db
		.insert(userIpAddresses)
		.values({
			userId,
			ipAddress,
			ipAddressHash,
			firstSeenAt: now,
			lastSeenAt: now,
		})
		.onConflictDoUpdate({
			target: [userIpAddresses.userId, userIpAddresses.ipAddress],
			set: {
				ipAddressHash,
				lastSeenAt: sql`CASE
					WHEN ${userIpAddresses.lastSeenAt} < NOW() - INTERVAL '15 minutes'
					THEN ${now}
					ELSE ${userIpAddresses.lastSeenAt}
				END`,
			},
		})
}
