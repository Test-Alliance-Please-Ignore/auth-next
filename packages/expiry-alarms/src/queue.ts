const DEFAULT_PREFIX = 'expiry-alarm:'
const DEFAULT_BATCH_SIZE = 25
const DEFAULT_LEASE_MS = 60_000
const MIN_ALARM_DELAY_MS = 1_000

export type PastDuePolicy = 'process' | 'discard'

export interface ExpiryAlarmRetryPolicy {
	maxAttempts: number
	baseDelayMs: number
	maxDelayMs: number
	 jitter?: number
	onExhausted?: 'retain' | 'remove'
}

export interface ExpiryAlarmQueueOptions<T> {
	prefix?: string
	batchSize?: number
	leaseMs?: number
	pastDue?: PastDuePolicy
	retry?: Partial<ExpiryAlarmRetryPolicy>
	now?: () => number
	random?: () => number
	handler?: ExpiryAlarmHandler<T>
}

export interface ExpiryAlarmItem<T> {
	id: string
	dueAt: number
	payload: T
}

export interface ExpiryAlarmEntry<T> {
	id: string
	dueAt: number
	payload: T
	generation: number
	attempt: number
	leaseId?: string
	leaseUntil?: number
	failedAt?: number
	lastError?: string
}

export interface ExpiryAlarmHandlerContext<T> {
	id: string
	payload: T
	dueAt: number
	attempt: number
	claimId: string
}

export type ExpiryAlarmHandlerResult<T> =
	| { action: 'complete' }
	| { action: 'discard' }
	| { action: 'reschedule'; dueAt: number; payload?: T }
	| { action: 'retry'; delayMs?: number; payload?: T }

export type ExpiryAlarmHandler<T> = (
	context: ExpiryAlarmHandlerContext<T>
) => Promise<ExpiryAlarmHandlerResult<T>> | ExpiryAlarmHandlerResult<T>

export interface ExpiryAlarmMutationResult {
	id: string
	generation: number
	dueAt: number
}

export interface ExpiryAlarmRunResult {
	claimed: number
	completed: number
	rescheduled: number
	retried: number
	discarded: number
	failed: number
}

interface StoredEntry<T> extends ExpiryAlarmEntry<T> {
	status: 'active' | 'failed'
}

export class ExpiryAlarmQueue<T> {
	private readonly storage: DurableObjectStorage
	private readonly prefix: string
	private readonly entryPrefix: string
	private readonly batchSize: number
	private readonly leaseMs: number
	private readonly pastDue: PastDuePolicy
	private readonly retry: ExpiryAlarmRetryPolicy
	private readonly now: () => number
	private readonly random: () => number
	private readonly handler?: ExpiryAlarmHandler<T>

	constructor(storage: DurableObjectStorage, options: ExpiryAlarmQueueOptions<T> = {}) {
		this.storage = storage
		this.prefix = options.prefix ?? DEFAULT_PREFIX
		this.entryPrefix = `${this.prefix}entry:`
		this.batchSize = positiveInteger(options.batchSize, DEFAULT_BATCH_SIZE)
		this.leaseMs = positiveInteger(options.leaseMs, DEFAULT_LEASE_MS)
		this.pastDue = options.pastDue ?? 'process'
		this.retry = {
			maxAttempts: nonNegativeInteger(options.retry?.maxAttempts, 0),
			baseDelayMs: positiveInteger(options.retry?.baseDelayMs, 5_000),
			maxDelayMs: positiveInteger(options.retry?.maxDelayMs, 300_000),
			jitter: clamp(options.retry?.jitter ?? 0, 0, 1),
			onExhausted: options.retry?.onExhausted ?? 'retain',
		}
		if (this.retry.maxDelayMs < this.retry.baseDelayMs) {
			throw new Error('Expiry alarm max retry delay must be >= base retry delay')
		}
		this.now = options.now ?? Date.now
		this.random = options.random ?? Math.random
		this.handler = options.handler
	}

	async initialize(): Promise<void> {
		await this.repair()
	}

	async upsert(id: string, dueAt: number, payload: T): Promise<ExpiryAlarmMutationResult> {
		this.assertId(id)
		this.assertDueAt(dueAt)
		const result = await this.storage.transaction(async (transaction) => {
			const key = this.key(id)
			const existing = await transaction.get<StoredEntry<T>>(key)
			const generation = (existing?.generation ?? 0) + 1
			const entry: StoredEntry<T> = {
				id,
				dueAt,
				payload,
				generation,
				attempt: 0,
				status: 'active',
			}
			await transaction.put(key, entry)
			await this.reconcileTransaction(transaction, this.now())
			return { id, generation, dueAt }
		})
		return result
	}

	async schedule(dueAt: number, payload: T, id = crypto.randomUUID()): Promise<ExpiryAlarmMutationResult> {
		return this.upsert(id, dueAt, payload)
	}

	async cancel(id: string): Promise<boolean> {
		this.assertId(id)
		return this.storage.transaction(async (transaction) => {
			const deleted = await transaction.delete(this.key(id))
			await this.reconcileTransaction(transaction, this.now())
			return deleted
		})
	}

	async replace(items: ReadonlyArray<ExpiryAlarmItem<T>>): Promise<void> {
		const normalized = items.map((item) => {
			this.assertId(item.id)
			this.assertDueAt(item.dueAt)
			return item
		})
		const ids = new Set(normalized.map((item) => item.id))
		if (ids.size !== normalized.length) throw new Error('Expiry alarm replacement contains duplicate item ids')
		await this.storage.transaction(async (transaction) => {
			const existing = await transaction.list<StoredEntry<T>>({ prefix: this.entryPrefix })
			const deletes: string[] = []
			for (const [key, entry] of existing) {
				if (!ids.has(entry.id)) deletes.push(key)
			}
			if (deletes.length > 0) await transaction.delete(deletes)

			const values: Record<string, StoredEntry<T>> = {}
			for (const item of normalized) {
				const previous = existing.get(this.key(item.id))
				values[this.key(item.id)] = {
					id: item.id,
					dueAt: item.dueAt,
					payload: item.payload,
					generation: (previous?.generation ?? 0) + 1,
					attempt: 0,
					status: 'active',
				}
			}
			if (Object.keys(values).length > 0) await transaction.put(values)
			await this.reconcileTransaction(transaction, this.now())
		})
	}

	async list(options: { includeFailed?: boolean } = {}): Promise<Array<ExpiryAlarmEntry<T>>> {
		const entries = await this.storage.list<StoredEntry<T>>({ prefix: this.entryPrefix })
		return [...entries.values()]
			.filter((entry) => options.includeFailed || entry.status === 'active')
			.sort((left, right) => left.dueAt - right.dueAt || left.id.localeCompare(right.id))
			.map(({ status: _status, ...entry }) => entry)
	}

	async repair(): Promise<void> {
		await this.storage.transaction((transaction) => this.reconcileTransaction(transaction, this.now()))
	}

	async alarm(): Promise<ExpiryAlarmRunResult> {
		if (!this.handler) throw new Error('Expiry alarm handler is not configured')
		const now = this.now()
		const claims = await this.claimDue(now)
		const result: ExpiryAlarmRunResult = {
			claimed: claims.length,
			completed: 0,
			rescheduled: 0,
			retried: 0,
			discarded: 0,
			failed: 0,
		}

		for (const claim of claims) {
			try {
				const outcome = await this.handler({
					id: claim.id,
					payload: claim.payload,
					dueAt: claim.dueAt,
					attempt: claim.attempt,
					claimId: claim.leaseId!,
				})
				const applied = await this.applyOutcome(claim, outcome)
				if (!applied) continue
				if (outcome.action === 'complete') result.completed++
				if (outcome.action === 'discard') result.discarded++
				if (outcome.action === 'reschedule') result.rescheduled++
				if (outcome.action === 'retry') result.retried++
			} catch (error) {
				const applied = await this.applyError(claim, error)
				if (applied === 'retry') result.retried++
				if (applied === 'failed') result.failed++
			}
		}

		await this.repair()
		return result
	}

	private async claimDue(now: number): Promise<Array<StoredEntry<T>>> {
		return this.storage.transaction(async (transaction) => {
			const entries = await transaction.list<StoredEntry<T>>({ prefix: this.entryPrefix })
			const due = [...entries.values()]
				.filter(
					(entry) =>
						entry.status === 'active' &&
						entry.dueAt <= now &&
						(!entry.leaseUntil || entry.leaseUntil <= now)
				)
				.sort((left, right) => left.dueAt - right.dueAt || left.id.localeCompare(right.id))
				.slice(0, this.batchSize)
			const claims: Array<StoredEntry<T>> = []
			for (const entry of due) {
				const leaseId = crypto.randomUUID()
				const claimed = {
					...entry,
					attempt: entry.attempt + 1,
					leaseId,
					leaseUntil: now + this.leaseMs,
				}
				await transaction.put(this.key(entry.id), claimed)
				claims.push(claimed)
			}
			await this.reconcileTransaction(transaction, now)
			return claims
		})
	}

	private async applyOutcome(
		claim: StoredEntry<T>,
		outcome: ExpiryAlarmHandlerResult<T>
	): Promise<boolean> {
		return this.storage.transaction(async (transaction) => {
			const current = await transaction.get<StoredEntry<T>>(this.key(claim.id))
			if (!this.ownsClaim(current, claim)) return false
			if (outcome.action === 'complete' || outcome.action === 'discard') {
				await transaction.delete(this.key(claim.id))
				return true
			}
			const dueAt = outcome.action === 'reschedule'
				? outcome.dueAt
				: this.now() + (outcome.delayMs ?? this.retryDelay(claim.attempt))
			this.assertDueAt(dueAt)
			await transaction.put(this.key(claim.id), {
				...current,
				payload: outcome.payload ?? current.payload,
				dueAt,
				leaseId: undefined,
				leaseUntil: undefined,
				status: 'active',
				lastError: undefined,
			})
			await this.reconcileTransaction(transaction, this.now())
			return true
		})
	}

	private async applyError(claim: StoredEntry<T>, error: unknown): Promise<'retry' | 'failed' | 'stale'> {
		return this.storage.transaction(async (transaction) => {
			const current = await transaction.get<StoredEntry<T>>(this.key(claim.id))
			if (!this.ownsClaim(current, claim)) return 'stale'
			const message = error instanceof Error ? error.message : String(error)
			if (claim.attempt <= this.retry.maxAttempts) {
				await transaction.put(this.key(claim.id), {
					...current,
					dueAt: this.now() + this.retryDelay(claim.attempt),
					leaseId: undefined,
					leaseUntil: undefined,
					lastError: message,
				})
				await this.reconcileTransaction(transaction, this.now())
				return 'retry'
			}
			if (this.retry.onExhausted === 'remove') {
				await transaction.delete(this.key(claim.id))
			} else {
				await transaction.put(this.key(claim.id), {
					...current,
					status: 'failed',
					failedAt: this.now(),
					leaseId: undefined,
					leaseUntil: undefined,
					lastError: message,
				})
			}
			await this.reconcileTransaction(transaction, this.now())
			return 'failed'
		})
	}

	private async reconcileTransaction(transaction: DurableObjectTransaction, now: number): Promise<void> {
		const entries = await transaction.list<StoredEntry<T>>({ prefix: this.entryPrefix })
		const expiredLeases: Record<string, StoredEntry<T>> = {}
		const expiredPastDue: string[] = []
		let nextAlarmAt: number | null = null

		for (const [key, entry] of entries) {
			if (entry.status === 'failed') continue
			if (entry.leaseId && (entry.leaseUntil ?? 0) <= now) {
				expiredLeases[key] = { ...entry, leaseId: undefined, leaseUntil: undefined }
				entry.leaseId = undefined
				entry.leaseUntil = undefined
			}
			if (this.pastDue === 'discard' && entry.dueAt <= now && !entry.leaseId) {
				expiredPastDue.push(key)
				continue
			}
			const candidate = entry.leaseUntil ?? entry.dueAt
			if (nextAlarmAt === null || candidate < nextAlarmAt) nextAlarmAt = candidate
		}

		if (expiredPastDue.length > 0) await transaction.delete(expiredPastDue)
		if (Object.keys(expiredLeases).length > 0) await transaction.put(expiredLeases)

		if (nextAlarmAt === null || (entries.size > 0 && expiredPastDue.length === entries.size)) {
			await transaction.deleteAlarm()
			return
		}
		await transaction.setAlarm(Math.max(now + MIN_ALARM_DELAY_MS, nextAlarmAt))
	}

	private ownsClaim(current: StoredEntry<T> | undefined, claim: StoredEntry<T>): current is StoredEntry<T> {
		return Boolean(
			current &&
			current.status === 'active' &&
			current.generation === claim.generation &&
			current.leaseId === claim.leaseId
		)
	}

	private retryDelay(attempt: number): number {
		const exponential = Math.min(
			this.retry.maxDelayMs,
			this.retry.baseDelayMs * 2 ** Math.max(0, attempt - 1)
		)
		const jitter = exponential * (this.retry.jitter ?? 0) * (this.random() * 2 - 1)
		return Math.max(MIN_ALARM_DELAY_MS, Math.round(exponential + jitter))
	}

	private key(id: string): string {
		return `${this.entryPrefix}${encodeURIComponent(id)}`
	}

	private assertId(id: string): void {
		if (!id || typeof id !== 'string') throw new Error('Expiry alarm item id must be a non-empty string')
	}

	private assertDueAt(dueAt: number): void {
		if (!Number.isFinite(dueAt) || dueAt < 0) throw new Error('Expiry alarm dueAt must be a finite timestamp')
	}
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value))
}
