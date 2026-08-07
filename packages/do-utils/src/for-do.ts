// ============================================================================
// @repo/do-utils — fluent, type-safe Durable Object namespace accessor.
//
// One entry point wraps a DO binding and exposes all three access modes:
//
//   forDO(env.FLEETS).singleton()                 -> the one global instance
//   forDO(env.EVE_CORPORATION_DATA).byName(corpId) -> one instance per entity
//   forDO(env.EVE_TOKEN_STORE).sharded({ shards: 16 }).forKey(characterId)
//
// TYPING is resolved ONCE, at the wrap site, and flows to every mode:
//   * Same-worker bindings are DurableObjectNamespace<FooDO> (branded): the stub
//     type is INFERRED as DurableObjectStub<FooDO> with zero generics.
//   * Cross-worker service bindings are DurableObjectNamespace<undefined>: the
//     runtime cannot see the class, so supply the shared RPC interface once, e.g.
//         forDO<EveTokenStore>(env.EVE_TOKEN_STORE).byName(characterId)
//   * Unbranded binding wrapped WITHOUT an interface -> ExplicitInterfaceRequired,
//     whose only member is a guidance string, so every method call fails to
//     compile with a readable "pass the interface" message.
//
// DISPOSAL belongs to the caller of an RPC method, not to this namespace
// accessor. The stub itself is not disposed, but every non-primitive value
// returned by a cross-worker method must be consumed and disposed. Use
// `withRpcResult` from this package when the shared interface is Promise-typed,
// or native `using` when the return type is declared as Disposable.
//
// CLAUDE.md rule: idFromName / getByName / jurisdiction are called ONLY inside
// this module (in `route`), never at a call site — including the sharded paths.
//
// DurableObjectNamespace, DurableObjectStub, DurableObjectId,
// DurableObjectLocationHint, DurableObjectJurisdiction and the `Rpc` namespace
// are ambient globals from worker-configuration.d.ts, referenced without imports
// (same convention as the rest of this package). No `any` in the public surface.
// ============================================================================

/** Placement option forwarded to the runtime on first instantiation only. */
export interface StubOptions {
	/**
	 * Best-effort first-placement hint. Honored ONLY on the object's first
	 * creation (DOs never relocate); never a guarantee — use `.jurisdiction()`
	 * for a hard compliance boundary.
	 */
	locationHint?: DurableObjectLocationHint
}

/**
 * Structural, brand-erased upper bound for any DO namespace.
 *
 * `DurableObjectNamespace<T>` is *invariant* in `T`, so no single instantiation
 * is assignable from both branded (same-worker) and unbranded (cross-worker)
 * bindings. This structural shape is satisfied by every `DurableObjectNamespace`
 * regardless of its brand, yet still rejects non-DO bindings (KV/R2/fetchers) —
 * a real bound without resorting to `any`, and one that lets this module
 * type-check in isolation.
 */
export interface AnyDoNamespace {
	get(id: DurableObjectId, options?: StubOptions): unknown
	getByName(name: string, options?: StubOptions): unknown
	jurisdiction(jurisdiction: DurableObjectJurisdiction): AnyDoNamespace
}

/**
 * Compile-time nudge produced when a cross-worker (unbranded) namespace is
 * wrapped without an explicit RPC interface. Every client method returns this
 * type, so any call fails to type-check with the guidance below.
 */
export interface ExplicitInterfaceRequired {
	readonly __doUtils: 'This binding is a cross-worker DurableObjectNamespace<undefined>; its stub type cannot be inferred. Pass the RPC interface explicitly, e.g. forDO<MyDoInterface>(env.BINDING).'
}

/**
 * Resolve the stub surface for a namespace:
 *  - explicit `T` (cross-worker): use the caller-supplied RPC interface verbatim
 *    (these @repo interfaces are already Promise-typed and may be Pick<>-narrowed
 *    structural subsets, so they are not re-wrapped in DurableObjectStub).
 *  - no `T`, branded namespace (same-worker): infer `DurableObjectStub<I>`.
 *  - no `T`, unbranded namespace: `ExplicitInterfaceRequired`.
 *
 * `[T] extends [never]` uses the tuple guard so the check never distributes.
 */
export type ResolveStub<NS extends AnyDoNamespace, T> = [T] extends [never]
	? NS extends DurableObjectNamespace<infer I>
		? I extends Rpc.DurableObjectBranded
			? DurableObjectStub<I>
			: ExplicitInterfaceRequired
		: ExplicitInterfaceRequired
	: T

/** Config for a fixed-N sharded view. `shards` MUST be a stable, grow-only constant. */
export interface ShardOptions {
	/** Number of sibling shard instances. Treat as immutable; only ever increase it. */
	shards: number
	/**
	 * Reserved name prefix for shard instances (default `'shard'`), producing DO
	 * names `${prefix}:0 … ${prefix}:N-1`. Pass a distinct prefix for a binding
	 * that is BOTH per-name and sharded so shard names cannot collide with an
	 * entity key. Changing the prefix re-routes every key — treat as frozen.
	 */
	prefix?: string
}

/**
 * Fixed-N sharded view over a namespace. Key -> shard routing is stable and
 * dependency-free (FNV-1a-64 digest -> Lamping-Veach jump consistent hash).
 */
export interface ShardedClient<Stub> {
	/** The immutable shard count this view was created with. */
	readonly shards: number
	/** Route one key to its owning shard and return that shard's stub. */
	forKey(key: string, options?: StubOptions): Stub
	/** Address a specific shard by index (range-checked) — for backfill/maintenance. */
	shard(index: number, options?: StubOptions): Stub
	/** Stubs for every shard, in index order — the scatter half of scatter/gather. */
	all(options?: StubOptions): Stub[]
	/**
	 * Fan `fn` out across all shards concurrently and collect results in shard
	 * order. Cost is O(N) billed RPC sessions — keep N modest and fan-out
	 * infrequent. NOTE: `fn` should return serializable data. If a shard method
	 * returns a non-primitive RPC value, the CALLER owns each returned value and
	 * must dispose it (`using` or `withRpcResult`) — map() does not, and must not,
	 * dispose the shard sessions out from under those results.
	 */
	map<R>(fn: (stub: Stub, shardIndex: number) => Promise<R> | R): Promise<R[]>
}

/** Fluent client wrapping a single DO namespace and exposing all three modes. */
export interface DoClient<Stub> {
	/**
	 * The one global-singleton instance. Always resolves to `getByName('default')`
	 * — the same id as `idFromName('default')`, so existing populated state is
	 * preserved. A DO historically keyed on a different literal ('gateway',
	 * 'global', 'universe') is honestly a fixed-name entity: use `.byName(key)`.
	 */
	singleton(options?: StubOptions): Stub
	/** Entity-scoped access by name (e.g. characterId, `fleet-${id}`, `region-${id}`). */
	byName(name: string, options?: StubOptions): Stub
	/** Access by a pre-resolved / persisted DurableObjectId (e.g. rehydrated newUniqueId). */
	byId(id: DurableObjectId, options?: StubOptions): Stub
	/** Create a fixed-N sharded view; construct once and reuse so N stays constant. */
	sharded(options: ShardOptions): ShardedClient<Stub>
	/** Re-scope to a compliance jurisdiction. Changes the derived id (in-region identity). */
	jurisdiction(jurisdiction: DurableObjectJurisdiction): DoClient<Stub>
}

const DEFAULT_SINGLETON_KEY = 'default'
const DEFAULT_SHARD_PREFIX = 'shard'

// --- Jump consistent hash (Lamping & Veach, 2014) over an FNV-1a-64 digest. ---
// Dependency-free, allocation-free, uniformly balanced. Growing N -> N+1 remaps
// only ~1/(N+1) of keys (all onto the new highest shard, none shuffled between
// existing shards). DO storage never migrates, so `shards` is GROW-ONLY and the
// constants + naming below are a FROZEN contract: changing any of them re-routes
// every key and orphans per-instance storage.
const U64_MASK = (1n << 64n) - 1n
const FNV_OFFSET = 14695981039346656037n
const FNV_PRIME = 1099511628211n
const LCG_MULT = 2862933555777941757n

function assertShardCount(shards: number): void {
	if (!Number.isInteger(shards) || shards < 1) {
		throw new RangeError(
			`@repo/do-utils: shards must be a positive integer, received ${String(shards)}`
		)
	}
}

/** FNV-1a 64-bit digest of a string key, hashing BOTH bytes of each UTF-16 code
 *  unit so non-ASCII keys distribute cleanly while staying deterministic. */
function hashKeyToU64(key: string): bigint {
	let h = FNV_OFFSET
	for (let i = 0; i < key.length; i++) {
		const c = key.charCodeAt(i)
		h ^= BigInt(c & 0xff)
		h = (h * FNV_PRIME) & U64_MASK
		h ^= BigInt((c >> 8) & 0xff)
		h = (h * FNV_PRIME) & U64_MASK
	}
	return h
}

/**
 * Map a string key to a shard index in `[0, shards)` via jump consistent hash.
 * Exported for unit tests and for aggregation/backfill jobs that need a key's
 * home shard without materialising a stub.
 */
export function shardIndex(key: string, shards: number): number {
	assertShardCount(shards)
	if (shards === 1) return 0
	let k = hashKeyToU64(key)
	let b = -1n
	let j = 0n
	const n = BigInt(shards)
	while (j < n) {
		b = j
		k = (k * LCG_MULT + 1n) & U64_MASK // 64-bit LCG step
		j = ((b + 1n) * (1n << 31n)) / ((k >> 33n) + 1n) // floor((b+1) * 2^31 / ((k>>33)+1))
	}
	return Number(b)
}

/** Deterministic shard instance name: `${prefix}:${shardIndex(key, shards)}`. */
export function shardName(
	key: string,
	shards: number,
	prefix: string = DEFAULT_SHARD_PREFIX
): string {
	return `${prefix}:${shardIndex(key, shards)}`
}

class ShardedClientImpl<Stub> implements ShardedClient<Stub> {
	constructor(
		private readonly ns: AnyDoNamespace,
		public readonly shards: number,
		private readonly prefix: string
	) {
		assertShardCount(shards)
	}

	forKey(key: string, options?: StubOptions): Stub {
		return this.ns.getByName(
			`${this.prefix}:${shardIndex(key, this.shards)}`,
			options
		) as unknown as Stub
	}

	shard(index: number, options?: StubOptions): Stub {
		if (!Number.isInteger(index) || index < 0 || index >= this.shards) {
			throw new RangeError(`@repo/do-utils: shard index ${index} out of range [0, ${this.shards})`)
		}
		return this.ns.getByName(`${this.prefix}:${index}`, options) as unknown as Stub
	}

	all(options?: StubOptions): Stub[] {
		const out: Stub[] = []
		for (let i = 0; i < this.shards; i++) {
			out.push(this.ns.getByName(`${this.prefix}:${i}`, options) as unknown as Stub)
		}
		return out
	}

	async map<R>(fn: (stub: Stub, shardIndex: number) => Promise<R> | R): Promise<R[]> {
		const stubs = this.all()
		return Promise.all(stubs.map((stub, i) => Promise.resolve(fn(stub, i))))
	}
}

class DoClientImpl<Stub> implements DoClient<Stub> {
	constructor(private readonly ns: AnyDoNamespace) {}

	// The ONLY place get/getByName is invoked for name-derived modes.
	private route(name: string, options?: StubOptions): Stub {
		return this.ns.getByName(name, options) as unknown as Stub
	}

	singleton(options?: StubOptions): Stub {
		return this.route(DEFAULT_SINGLETON_KEY, options)
	}

	byName(name: string, options?: StubOptions): Stub {
		return this.route(name, options)
	}

	byId(id: DurableObjectId, options?: StubOptions): Stub {
		return this.ns.get(id, options) as unknown as Stub
	}

	sharded(options: ShardOptions): ShardedClient<Stub> {
		return new ShardedClientImpl<Stub>(
			this.ns,
			options.shards,
			options.prefix ?? DEFAULT_SHARD_PREFIX
		)
	}

	jurisdiction(jurisdiction: DurableObjectJurisdiction): DoClient<Stub> {
		// jurisdiction is baked into id derivation, so transform the namespace
		// once, up front — every subsequent name/shard is derived in-region.
		return new DoClientImpl<Stub>(this.ns.jurisdiction(jurisdiction))
	}
}

/**
 * Wrap a Durable Object namespace in a fluent, type-safe client covering the
 * global-singleton, per-name, and sharded (+ fan-out) access modes.
 *
 * Same-worker (branded) bindings infer their stub type — no generic needed:
 *   const fleets = forDO(env.FLEETS)              // DoClient<DurableObjectStub<FleetsDO>>
 *
 * Cross-worker service bindings are `DurableObjectNamespace<undefined>`; supply
 * the shared RPC interface once and every mode is typed from it:
 *   const tokens = forDO<EveTokenStore>(env.EVE_TOKEN_STORE)
 */
export function forDO<T = never, NS extends AnyDoNamespace = AnyDoNamespace>(
	namespace: NS
): DoClient<ResolveStub<NS, T>> {
	return new DoClientImpl<ResolveStub<NS, T>>(namespace)
}
