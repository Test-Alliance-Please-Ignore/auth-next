import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { and, eq, sql } from '@repo/db-utils'

import { createDb } from '../../db'
import { latestMarketPrices, marketOrders, marketSnapshots } from '../../db/schema'

import type { MarketsDO } from '../../durable-object'

// Mock data for testing
const createMockSnapshot = (
	locationId: string,
	locationType: 'region' | 'structure',
	snapshotTime: Date
) => ({
	id: crypto.randomUUID(),
	locationId,
	locationType,
	snapshotTime,
	status: 'complete' as const,
	orderCount: 100,
	fetchDurationMs: 1000,
	createdAt: new Date(),
	updatedAt: new Date(),
})

const createMockOrder = (snapshotId: string, typeId: number, price: number) => ({
	id: crypto.randomUUID(),
	snapshotId,
	orderId: String(Math.floor(Math.random() * 1000000000)),
	typeId: String(typeId),
	locationId: '60003760', // Jita
	systemId: '30000142', // Jita system
	volumeRemain: '100',
	volumeTotal: '100',
	minVolume: '1',
	price: String(price),
	isBuyOrder: false,
	duration: 30,
	issued: new Date(),
	range: 'station' as const,
	sourceLocationId: '10000002',
	sourceLocationType: 'region' as const,
	snapshotTime: new Date(),
})

describe('Snapshot Cleanup', () => {
	let db: ReturnType<typeof createDb>

	beforeEach(() => {
		// Initialize test database
		db = createDb(env.DATABASE_URL)
	})

	it('should delete oldest snapshots when limit is exceeded', async () => {
		const locationId = '10000002' // The Forge
		const locationType = 'region'
		const maxSnapshots = 3

		// Create 5 snapshots (2 will be deleted)
		const now = new Date()
		const snapshots = []
		for (let i = 0; i < 5; i++) {
			const snapshotTime = new Date(now.getTime() - i * 60 * 60 * 1000) // 1 hour apart
			snapshots.push(createMockSnapshot(locationId, locationType, snapshotTime))
		}

		// Insert snapshots
		await db.insert(marketSnapshots).values(snapshots)

		// Simulate cleanup logic
		const totalCount = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					eq(marketSnapshots.status, 'complete')
				)
			)

		expect(totalCount[0].count).toBe(5)

		// Get oldest snapshots to delete
		const deleteCount = totalCount[0].count - maxSnapshots
		const snapshotsToDelete = await db
			.select({ id: marketSnapshots.id })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					eq(marketSnapshots.status, 'complete')
				)
			)
			.orderBy(marketSnapshots.snapshotTime)
			.limit(deleteCount)

		expect(snapshotsToDelete.length).toBe(2)

		// Delete snapshots
		const snapshotIds = snapshotsToDelete.map((s) => s.id)
		await db
			.delete(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					sql`${marketSnapshots.id} IN (${sql.join(snapshotIds, sql`, `)})`
				)
			)

		// Verify only 3 snapshots remain
		const remaining = await db
			.select()
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType)
				)
			)

		expect(remaining.length).toBe(3)
	})

	it('should preserve most recent snapshots', async () => {
		const locationId = '10000002'
		const locationType = 'region'
		const maxSnapshots = 2

		// Create 4 snapshots with distinct times
		const now = new Date()
		const snapshots = [
			createMockSnapshot(locationId, locationType, new Date(now.getTime() - 3 * 60 * 60 * 1000)), // oldest
			createMockSnapshot(locationId, locationType, new Date(now.getTime() - 2 * 60 * 60 * 1000)),
			createMockSnapshot(locationId, locationType, new Date(now.getTime() - 1 * 60 * 60 * 1000)),
			createMockSnapshot(locationId, locationType, now), // newest
		]

		await db.insert(marketSnapshots).values(snapshots)

		// Simulate cleanup
		const deleteCount = snapshots.length - maxSnapshots
		const snapshotsToDelete = await db
			.select({ id: marketSnapshots.id, snapshotTime: marketSnapshots.snapshotTime })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					eq(marketSnapshots.status, 'complete')
				)
			)
			.orderBy(marketSnapshots.snapshotTime)
			.limit(deleteCount)

		const deleteIds = snapshotsToDelete.map((s) => s.id)
		await db
			.delete(marketSnapshots)
			.where(sql`${marketSnapshots.id} IN (${sql.join(deleteIds, sql`, `)})`)

		// Verify newest 2 snapshots remain
		const remaining = await db
			.select({ snapshotTime: marketSnapshots.snapshotTime })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType)
				)
			)
			.orderBy(marketSnapshots.snapshotTime)

		expect(remaining.length).toBe(2)
		expect(remaining[0].snapshotTime.getTime()).toBeGreaterThan(snapshots[1].snapshotTime.getTime())
		expect(remaining[1].snapshotTime).toEqual(snapshots[3].snapshotTime)
	})

	it('should not delete snapshots when at or below limit', async () => {
		const locationId = '10000002'
		const locationType = 'region'
		const maxSnapshots = 5

		// Create exactly 5 snapshots
		const snapshots = []
		for (let i = 0; i < 5; i++) {
			snapshots.push(createMockSnapshot(locationId, locationType, new Date()))
		}

		await db.insert(marketSnapshots).values(snapshots)

		// Count total snapshots
		const totalCount = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					eq(marketSnapshots.status, 'complete')
				)
			)

		expect(totalCount[0].count).toBe(5)

		// No deletion should occur since we're at the limit
		const deleteCount = Math.max(0, totalCount[0].count - maxSnapshots)
		expect(deleteCount).toBe(0)

		// Verify all snapshots remain
		const remaining = await db
			.select()
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType)
				)
			)

		expect(remaining.length).toBe(5)
	})

	it('should only delete snapshots with status "complete"', async () => {
		const locationId = '10000002'
		const locationType = 'region'
		const maxSnapshots = 2

		// Create mixed status snapshots
		const snapshots = [
			{
				...createMockSnapshot(locationId, locationType, new Date(Date.now() - 4 * 60 * 60 * 1000)),
				status: 'complete' as const,
			},
			{
				...createMockSnapshot(locationId, locationType, new Date(Date.now() - 3 * 60 * 60 * 1000)),
				status: 'failed' as const,
			},
			{
				...createMockSnapshot(locationId, locationType, new Date(Date.now() - 2 * 60 * 60 * 1000)),
				status: 'complete' as const,
			},
			{
				...createMockSnapshot(locationId, locationType, new Date(Date.now() - 1 * 60 * 60 * 1000)),
				status: 'pending' as const,
			},
			{ ...createMockSnapshot(locationId, locationType, new Date()), status: 'complete' as const },
		]

		await db.insert(marketSnapshots).values(snapshots)

		// Count only complete snapshots
		const completeCount = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					eq(marketSnapshots.status, 'complete')
				)
			)

		expect(completeCount[0].count).toBe(3) // Only 3 complete snapshots

		// Get oldest complete snapshots to delete
		const deleteCount = Math.max(0, completeCount[0].count - maxSnapshots)
		expect(deleteCount).toBe(1) // Should delete 1 snapshot

		const snapshotsToDelete = await db
			.select({ id: marketSnapshots.id })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType),
					eq(marketSnapshots.status, 'complete')
				)
			)
			.orderBy(marketSnapshots.snapshotTime)
			.limit(deleteCount)

		await db.delete(marketSnapshots).where(
			sql`${marketSnapshots.id} IN (${sql.join(
				snapshotsToDelete.map((s) => s.id),
				sql`, `
			)})`
		)

		// Verify failed and pending snapshots were not deleted
		const remaining = await db
			.select({ status: marketSnapshots.status })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, locationType)
				)
			)

		expect(remaining.length).toBe(4) // 2 complete + 1 failed + 1 pending
		expect(remaining.filter((r) => r.status === 'failed').length).toBe(1)
		expect(remaining.filter((r) => r.status === 'pending').length).toBe(1)
		expect(remaining.filter((r) => r.status === 'complete').length).toBe(2)
	})

	it('should handle cascade deletion of market_orders', async () => {
		const locationId = '10000002'
		const locationType = 'region'
		const snapshot = createMockSnapshot(locationId, locationType, new Date())

		// Insert snapshot
		await db.insert(marketSnapshots).values([snapshot])

		// Insert related orders
		const orders = [
			createMockOrder(snapshot.id, 34, 100.5),
			createMockOrder(snapshot.id, 34, 101.0),
			createMockOrder(snapshot.id, 35, 200.0),
		]
		await db.insert(marketOrders).values(orders)

		// Verify orders exist
		const orderCount = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(marketOrders)
			.where(eq(marketOrders.snapshotId, snapshot.id))

		expect(orderCount[0].count).toBe(3)

		// Delete snapshot
		await db.delete(marketSnapshots).where(eq(marketSnapshots.id, snapshot.id))

		// Verify orders were cascade deleted
		const remainingOrders = await db
			.select()
			.from(marketOrders)
			.where(eq(marketOrders.snapshotId, snapshot.id))

		expect(remainingOrders.length).toBe(0)
	})

	it('should cleanup orphaned latest_market_prices records', async () => {
		const locationId = '10000002'
		const locationType = 'region'
		const snapshot = createMockSnapshot(locationId, locationType, new Date())

		// Insert snapshot
		await db.insert(marketSnapshots).values([snapshot])

		// Insert latest prices
		await db.insert(latestMarketPrices).values([
			{
				id: crypto.randomUUID(),
				typeId: '34',
				locationId: '60003760',
				locationType: 'region',
				snapshotId: snapshot.id,
				snapshotTime: new Date(),
				totalBuyVolume: '0',
				buyOrderCount: 0,
				totalSellVolume: '0',
				sellOrderCount: 0,
			},
		])

		// Verify price exists
		const priceCount = await db
			.select({ count: sql<number>`COUNT(*)` })
			.from(latestMarketPrices)
			.where(eq(latestMarketPrices.snapshotId, snapshot.id))

		expect(priceCount[0].count).toBe(1)

		// Delete snapshot
		await db.delete(marketSnapshots).where(eq(marketSnapshots.id, snapshot.id))

		// Manually cleanup orphaned prices (since no FK cascade)
		await db.delete(latestMarketPrices).where(eq(latestMarketPrices.snapshotId, snapshot.id))

		// Verify price was deleted
		const remainingPrices = await db
			.select()
			.from(latestMarketPrices)
			.where(eq(latestMarketPrices.snapshotId, snapshot.id))

		expect(remainingPrices.length).toBe(0)
	})

	it('should handle different location types separately', async () => {
		const locationId = '1234567890' // Same ID for both
		const maxSnapshots = 2

		// Create snapshots for region
		const regionSnapshots = [
			createMockSnapshot(locationId, 'region', new Date(Date.now() - 3 * 60 * 60 * 1000)),
			createMockSnapshot(locationId, 'region', new Date(Date.now() - 2 * 60 * 60 * 1000)),
			createMockSnapshot(locationId, 'region', new Date(Date.now() - 1 * 60 * 60 * 1000)),
		]

		// Create snapshots for structure
		const structureSnapshots = [
			createMockSnapshot(locationId, 'structure', new Date(Date.now() - 3 * 60 * 60 * 1000)),
			createMockSnapshot(locationId, 'structure', new Date(Date.now() - 2 * 60 * 60 * 1000)),
			createMockSnapshot(locationId, 'structure', new Date(Date.now() - 1 * 60 * 60 * 1000)),
		]

		await db.insert(marketSnapshots).values([...regionSnapshots, ...structureSnapshots])

		// Delete oldest region snapshot
		const regionToDelete = await db
			.select({ id: marketSnapshots.id })
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, 'region'),
					eq(marketSnapshots.status, 'complete')
				)
			)
			.orderBy(marketSnapshots.snapshotTime)
			.limit(1)

		await db.delete(marketSnapshots).where(sql`${marketSnapshots.id} = ${regionToDelete[0].id}`)

		// Verify region has 2 snapshots, structure still has 3
		const regionRemaining = await db
			.select()
			.from(marketSnapshots)
			.where(
				and(eq(marketSnapshots.locationId, locationId), eq(marketSnapshots.locationType, 'region'))
			)

		const structureRemaining = await db
			.select()
			.from(marketSnapshots)
			.where(
				and(
					eq(marketSnapshots.locationId, locationId),
					eq(marketSnapshots.locationType, 'structure')
				)
			)

		expect(regionRemaining.length).toBe(2)
		expect(structureRemaining.length).toBe(3)
	})
})
