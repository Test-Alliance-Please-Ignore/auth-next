import { DurableObject } from 'cloudflare:workers'

import { ExpiryAlarmQueue } from '@repo/expiry-alarms'

import {
	deleteCredentialHandoff,
	expireTempop,
	listTempopExpiryItems,
} from './services/mumble-tempop.service'

import type { ExpiryAlarmHandlerResult } from '@repo/expiry-alarms'
import type { Env } from './context'

export type MumbleTempopExpiryItem =
	| { kind: 'tempop'; tempopId: string }
	| { kind: 'credential-handoff'; tokenHash: string }

export interface MumbleTempopExpiry {
	scheduleTempop(tempopId: string, expiresAt: number): Promise<void>
	cancelTempop(tempopId: string): Promise<void>
	scheduleCredentialHandoff(tokenHash: string, expiresAt: number): Promise<void>
	cancelCredentialHandoff(tokenHash: string): Promise<void>
	reconcile(): Promise<{ scheduled: number }>
}

const PREFIX = 'mumble-tempop-expiry:'

export class MumbleTempopExpiryDO extends DurableObject<Env> implements MumbleTempopExpiry {
	private readonly queue: ExpiryAlarmQueue<MumbleTempopExpiryItem>

	constructor(
		private readonly state: DurableObjectState,
		public readonly env: Env
	) {
		super(state, env)
		this.queue = new ExpiryAlarmQueue(state.storage, {
			prefix: PREFIX,
			pastDue: 'process',
			retry: {
				maxAttempts: 3,
				baseDelayMs: 5_000,
				maxDelayMs: 5 * 60 * 1000,
				onExhausted: 'retain',
			},
			handler: (context) => this.handleItem(context.payload),
		})
		void state.blockConcurrencyWhile(() => this.queue.initialize())
	}

	async scheduleTempop(tempopId: string, expiresAt: number): Promise<void> {
		await this.queue.upsert(`tempop:${tempopId}`, expiresAt, {
			kind: 'tempop',
			tempopId,
		})
	}

	async cancelTempop(tempopId: string): Promise<void> {
		await this.queue.cancel(`tempop:${tempopId}`)
	}

	async scheduleCredentialHandoff(tokenHash: string, expiresAt: number): Promise<void> {
		await this.queue.upsert(`credential-handoff:${tokenHash}`, expiresAt, {
			kind: 'credential-handoff',
			tokenHash,
		})
	}

	async cancelCredentialHandoff(tokenHash: string): Promise<void> {
		await this.queue.cancel(`credential-handoff:${tokenHash}`)
	}

	async reconcile(): Promise<{ scheduled: number }> {
		const items = await listTempopExpiryItems(this.env)
		await this.queue.replace(items)
		return { scheduled: items.length }
	}

	async alarm(): Promise<void> {
		await this.queue.alarm()
	}

	private async handleItem(
		item: MumbleTempopExpiryItem
	): Promise<ExpiryAlarmHandlerResult<MumbleTempopExpiryItem>> {
		if (item.kind === 'tempop') {
			const result = await expireTempop(this.env, item.tempopId)
			if (result.rescheduleAt !== null) return { action: 'reschedule', dueAt: result.rescheduleAt }
			return { action: 'complete' }
		}

		await deleteCredentialHandoff(this.env, item.tokenHash)
		return { action: 'complete' }
	}
}
