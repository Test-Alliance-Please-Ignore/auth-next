import type { DiscordRateLimitRecord, DiscordRateLimitStore } from '@repo/discord'

type KvDiscordRateLimitRecord = DiscordRateLimitRecord

function serializeRecord(record: KvDiscordRateLimitRecord): string {
	return JSON.stringify(record)
}

function parseRecord(raw: string | null): KvDiscordRateLimitRecord | null {
	if (!raw) {
		return null
	}

	try {
		const parsed = JSON.parse(raw) as KvDiscordRateLimitRecord
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			typeof parsed.expiresAt !== 'number' ||
			typeof parsed.routeKey !== 'string'
		) {
			return null
		}
		return parsed
	} catch {
		return null
	}
}

function ttlSecondsFromExpiresAt(expiresAt: number): number {
	return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))
}

export function createDiscordRateLimitKvStore(
	kv: KVNamespace
): DiscordRateLimitStore {
	return {
		async get(key: string): Promise<KvDiscordRateLimitRecord | null> {
			const record = parseRecord(await kv.get(key))
			if (!record) {
				return null
			}

			if (record.expiresAt <= Date.now()) {
				await kv.delete(key)
				return null
			}

			return record
		},
		async put(
			key: string,
			value: KvDiscordRateLimitRecord,
			ttlSeconds: number
		): Promise<void> {
			await kv.put(key, serializeRecord(value), {
				expirationTtl: Math.max(1, ttlSeconds ?? ttlSecondsFromExpiresAt(value.expiresAt)),
			})
		},
		async delete(key: string): Promise<void> {
			await kv.delete(key)
		},
	}
}
