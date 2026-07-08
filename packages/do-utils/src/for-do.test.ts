import { describe, expect, it } from 'vitest'

import { forDO, shardIndex, shardName } from './for-do'

// ---------------------------------------------------------------------------
// shardIndex — the FNV-1a-64 -> Lamping-Veach jump-consistent-hash core.
//
// GOLDEN VECTORS: exact `shardIndex(key, N)` outputs captured from this module.
// They are a CHANGE DETECTOR for the FROZEN routing contract — the FNV/LCG
// constants and the two-byte UTF-16 hashing. If any of them change, these break
// in CI *before* the change can silently re-route production keys onto empty,
// un-backfilled shards. Do NOT "fix" a failure by updating the numbers unless
// you have consciously reshuffled every key and planned a full backfill.
// ---------------------------------------------------------------------------
const GOLDEN: Record<string, number> = {
	'default|1': 0,
	'default|2': 0,
	'default|4': 0,
	'default|8': 7,
	'default|16': 11,
	'default|64': 29,
	'gateway|2': 1,
	'gateway|16': 15,
	'90000001|8': 1,
	'90000001|64': 40,
	'fleet-12345|16': 0,
	'fleet-12345|64': 47,
	'region-10000002|8': 4,
	'region-10000002|16': 8,
	'corp:98000001|4': 3,
	'corp:98000001|16': 15,
	// Non-ASCII: exercises the two-byte-per-code-unit hashing path.
	'キャラクター|4': 3,
	'キャラクター|8': 5,
	'キャラクター|16': 14,
	'キャラクター|64': 47,
	// Empty string is a valid key (digest = FNV offset basis).
	'|2': 1,
	'|16': 13,
}

describe('shardIndex — golden vectors (frozen routing contract)', () => {
	for (const [spec, expected] of Object.entries(GOLDEN)) {
		const sep = spec.lastIndexOf('|')
		const key = spec.slice(0, sep)
		const shards = Number(spec.slice(sep + 1))
		it(`${JSON.stringify(key)} @ ${shards} shards -> ${expected}`, () => {
			expect(shardIndex(key, shards)).toBe(expected)
		})
	}
})

describe('shardIndex — invariants', () => {
	const keys = ['default', 'gateway', 'a', '90000001', 'fleet-12345', 'キャラクター', '', 'x'.repeat(256)]

	it('is deterministic — same (key, N) always maps to the same shard', () => {
		for (const key of keys) {
			for (const n of [1, 3, 7, 16, 100]) {
				expect(shardIndex(key, n)).toBe(shardIndex(key, n))
			}
		}
	})

	it('always returns an integer in [0, N)', () => {
		for (const key of keys) {
			for (const n of [1, 2, 5, 16, 97, 1000]) {
				const idx = shardIndex(key, n)
				expect(Number.isInteger(idx)).toBe(true)
				expect(idx).toBeGreaterThanOrEqual(0)
				expect(idx).toBeLessThan(n)
			}
		}
	})

	it('maps every key to shard 0 when N === 1', () => {
		for (const key of keys) {
			expect(shardIndex(key, 1)).toBe(0)
		}
	})

	it('is grow-only: N -> N+1 either keeps a key or moves it onto the new top shard (never reshuffles between existing shards)', () => {
		// The defining property of jump consistent hash. This is what makes growing
		// the shard count cheap (~1/(N+1) of keys move) and safe.
		for (const key of keys) {
			for (let n = 1; n < 128; n++) {
				const before = shardIndex(key, n)
				const after = shardIndex(key, n + 1)
				// after is either unchanged, or exactly the newly added shard index (n).
				expect(after === before || after === n).toBe(true)
			}
		}
	})

	it('distributes a large key population roughly uniformly', () => {
		const shards = 16
		const counts = new Array<number>(shards).fill(0)
		const total = 20_000
		for (let i = 0; i < total; i++) {
			counts[shardIndex(`entity-${i}`, shards)]++
		}
		const expectedPerShard = total / shards
		// Every shard should be within 25% of the mean — loose enough to never flake,
		// tight enough to catch a badly skewed or constant hash.
		for (const c of counts) {
			expect(c).toBeGreaterThan(expectedPerShard * 0.75)
			expect(c).toBeLessThan(expectedPerShard * 1.25)
		}
	})

	it('rejects invalid shard counts', () => {
		for (const bad of [0, -1, 1.5, NaN, Infinity]) {
			expect(() => shardIndex('k', bad)).toThrow(RangeError)
		}
	})
})

describe('shardName', () => {
	it('formats as `${prefix}:${index}` with the default prefix', () => {
		expect(shardName('fleet-12345', 16)).toBe('shard:0')
		expect(shardName('default', 16)).toBe('shard:11')
	})

	it('honors a custom prefix', () => {
		expect(shardName('x', 8, 'replica')).toBe(`replica:${shardIndex('x', 8)}`)
	})
})

// ---------------------------------------------------------------------------
// forDO routing — verify each mode targets the expected DO instance NAME.
// A minimal fake namespace records the name each mode resolves to (getByName),
// so we assert routing without a live Durable Object runtime.
// ---------------------------------------------------------------------------
interface RoutedStub {
	__name?: string
	__id?: unknown
}

function fakeNamespace(): {
	ns: {
		get(id: unknown): RoutedStub
		getByName(name: string): RoutedStub
		jurisdiction(j: string): unknown
	}
	byNameCalls: string[]
	jurisdictions: string[]
} {
	const byNameCalls: string[] = []
	const jurisdictions: string[] = []
	const ns = {
		get(id: unknown): RoutedStub {
			return { __id: id }
		},
		getByName(name: string): RoutedStub {
			byNameCalls.push(name)
			return { __name: name }
		},
		jurisdiction(j: string) {
			jurisdictions.push(j)
			return ns
		},
	}
	return { ns, byNameCalls, jurisdictions }
}

describe('forDO — mode routing', () => {
	// The fake satisfies the structural AnyDoNamespace shape; cast through unknown
	// since it is not a real branded DurableObjectNamespace.
	const wrap = (f: ReturnType<typeof fakeNamespace>) =>
		forDO<RoutedStub>(f.ns as unknown as Parameters<typeof forDO<RoutedStub>>[0])

	it('singleton() routes to getByName("default")', () => {
		const f = fakeNamespace()
		wrap(f).singleton()
		expect(f.byNameCalls).toEqual(['default'])
	})

	it('byName(name) routes to getByName(name)', () => {
		const f = fakeNamespace()
		wrap(f).byName('corp:98000001')
		expect(f.byNameCalls).toEqual(['corp:98000001'])
	})

	it('sharded().forKey(key) routes to the key\'s owning shard name', () => {
		const f = fakeNamespace()
		const shards = 16
		wrap(f).sharded({ shards }).forKey('fleet-12345')
		expect(f.byNameCalls).toEqual([shardName('fleet-12345', shards)])
	})

	it('sharded().shard(i) routes by index and range-checks', () => {
		const f = fakeNamespace()
		const client = wrap(f).sharded({ shards: 8 })
		client.shard(3)
		expect(f.byNameCalls).toEqual(['shard:3'])
		expect(() => client.shard(8)).toThrow(RangeError)
		expect(() => client.shard(-1)).toThrow(RangeError)
	})

	it('sharded().all() returns one stub per shard, in index order', () => {
		const f = fakeNamespace()
		const stubs = wrap(f).sharded({ shards: 4 }).all()
		expect(stubs.map((s) => s.__name)).toEqual(['shard:0', 'shard:1', 'shard:2', 'shard:3'])
	})

	it('sharded().map(fn) fans out across all shards and collects in order', async () => {
		const f = fakeNamespace()
		const names = await wrap(f)
			.sharded({ shards: 4 })
			.map((s) => s.__name)
		expect(names).toEqual(['shard:0', 'shard:1', 'shard:2', 'shard:3'])
	})

	it('sharded honors a custom prefix so shard names cannot collide with entity keys', () => {
		const f = fakeNamespace()
		wrap(f).sharded({ shards: 4, prefix: 'replica' }).forKey('k')
		expect(f.byNameCalls[0]).toBe(shardName('k', 4, 'replica'))
	})

	it('jurisdiction(j) transforms the namespace before deriving names', () => {
		const f = fakeNamespace()
		wrap(f).jurisdiction('eu' as unknown as DurableObjectJurisdiction).singleton()
		expect(f.jurisdictions).toEqual(['eu'])
		expect(f.byNameCalls).toEqual(['default'])
	})

	it('byId(id) routes through get(id), not getByName', () => {
		const f = fakeNamespace()
		const id = { toString: () => 'abc' }
		const stub = wrap(f).byId(id as unknown as DurableObjectId)
		expect(f.byNameCalls).toEqual([])
		expect(stub.__id).toBe(id)
	})
})
