import { describe, expect, it, beforeEach, vi } from 'vitest'
import { DkpService } from '../dkp.service'

/**
 * DKP Service Unit Tests
 *
 * Basic unit tests for DKP service business logic.
 * These tests verify the core functionality without requiring database setup.
 */

describe('DkpService', () => {
	let mockDb: any
	let dkpService: DkpService

	beforeEach(() => {
		// Create mock database client
		mockDb = {
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					returning: vi.fn(() =>
						Promise.resolve([
							{
								id: 'test-transaction-id',
								userId: 'test-user-id',
								characterId: '12345',
								characterName: 'Test Character',
								corporationId: '67890',
								corporationName: 'Test Corporation',
								amount: 100,
								sourceType: 'manual',
								earnedAt: new Date(),
								createdAt: new Date(),
							},
						])
					),
				})),
			})),
			query: {
				dkpTransactions: {
					findMany: vi.fn(() => Promise.resolve([])),
					findFirst: vi.fn(() => Promise.resolve(null)),
				},
				userCharacters: {
					findFirst: vi.fn(() => Promise.resolve({ userId: 'test-user-id' })),
				},
			},
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						groupBy: vi.fn(() => ({
							orderBy: vi.fn(() => ({
								limit: vi.fn(() => ({
									offset: vi.fn(() => Promise.resolve([])),
								})),
							})),
						})),
					})),
					groupBy: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(() => ({
								offset: vi.fn(() => Promise.resolve([])),
							})),
						})),
					})),
				})),
			})),
		}

		dkpService = new DkpService(mockDb as any)
	})

	describe('awardDkp', () => {
		it('should require non-zero amount', async () => {
			await expect(
				dkpService.awardDkp({
					characterId: '12345',
					corporationId: '67890',
					amount: 0,
					sourceType: 'manual',
					awardReason: 'Test award',
				})
			).rejects.toThrow('Amount cannot be zero')
		})

		it('should require reason for manual awards', async () => {
			await expect(
				dkpService.awardDkp({
					characterId: '12345',
					corporationId: '67890',
					amount: 100,
					sourceType: 'manual',
					// Missing awardReason
				})
			).rejects.toThrow('Reason is required for manual awards')
		})

		it('should require corporation ID when not provided', async () => {
			await expect(
				dkpService.awardDkp({
					characterId: '12345',
					// Missing corporationId
					amount: 100,
					sourceType: 'fleet',
				})
			).rejects.toThrow('Corporation ID is required')
		})
	})

	describe('awardDkpBulk', () => {
		it('should process multiple awards', async () => {
			// Mock successful transaction creation
			mockDb.insert.mockReturnValue({
				values: vi.fn(() => ({
					returning: vi.fn(() =>
						Promise.resolve([
							{
								id: 'test-transaction-1',
								userId: 'test-user-id',
								characterId: '12345',
								characterName: 'Character 1',
								corporationId: '67890',
								corporationName: 'Test Corp',
								amount: 100,
								sourceType: 'fleet',
								earnedAt: new Date(),
								createdAt: new Date(),
							},
						])
					),
				})),
			})

			// Mock getCharacterBalance and getCorporationBalance
			vi.spyOn(dkpService, 'getCharacterBalance').mockResolvedValue({
				characterId: '12345',
				characterName: 'Character 1',
				corporationId: '67890',
				corporationName: 'Test Corp',
				balance: {
					current: 100,
					allTime: 100,
					last7days: 100,
					last30days: 100,
					last90days: 100,
				},
			})

			vi.spyOn(dkpService, 'getCorporationBalance').mockResolvedValue({
				corporationId: '67890',
				corporationName: 'Test Corp',
				balance: {
					current: 100,
					allTime: 100,
					last7days: 100,
					last30days: 100,
					last90days: 100,
				},
				memberCount: 1,
				topEarners: [],
			})

			const result = await dkpService.awardDkpBulk({
				awards: [
					{
						characterId: '12345',
						corporationId: '67890',
						amount: 100,
					},
				],
				globalReason: 'Fleet participation',
				sourceType: 'fleet',
			})

			expect(result.success).toBe(true)
			expect(result.totalAwarded).toBe(1)
			expect(result.transactions).toHaveLength(1)
			expect(result.errors).toHaveLength(0)
		})

		it('should collect errors for failed awards', async () => {
			const result = await dkpService.awardDkpBulk({
				awards: [
					{
						characterId: '12345',
						// Missing corporationId - will fail
						amount: 100,
					},
				],
				globalReason: 'Test',
				sourceType: 'manual',
			})

			expect(result.success).toBe(false)
			expect(result.totalAwarded).toBe(0)
			expect(result.errors).toHaveLength(1)
			expect(result.errors[0].characterId).toBe('12345')
		})
	})

	describe('getStatistics', () => {
		it('should return statistics structure', async () => {
			// Mock empty transactions
			mockDb.query.dkpTransactions.findMany.mockResolvedValue([])

			// Mock aggregation queries
			mockDb.select.mockReturnValue({
				from: vi.fn(() => ({
					groupBy: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(() => Promise.resolve([])),
						})),
					})),
				})),
			})

			const stats = await dkpService.getStatistics()

			expect(stats).toHaveProperty('totals')
			expect(stats).toHaveProperty('breakdown')
			expect(stats).toHaveProperty('topCharacters')
			expect(stats).toHaveProperty('topCorporations')
			expect(stats.totals).toHaveProperty('allTime')
			expect(stats.totals).toHaveProperty('last7days')
			expect(stats.totals).toHaveProperty('last30days')
			expect(stats.totals).toHaveProperty('last90days')
		})
	})
})
