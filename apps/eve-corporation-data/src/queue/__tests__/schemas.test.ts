import { describe, expect, it } from 'vitest'
import * as schemas from '../schemas'

describe('Queue Message Schemas', () => {
	describe('publicRefreshMessageSchema', () => {
		it('should validate a valid message', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				requesterId: 'test-system',
			}

			const result = schemas.publicRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
		})

		it('should validate without requesterId', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			const result = schemas.publicRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
		})

		it('should reject invalid corporationId', () => {
			const message = {
				corporationId: 123, // number instead of string
				timestamp: Date.now(),
			}

			const result = schemas.publicRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})
	})

	describe('walletJournalRefreshMessageSchema', () => {
		it('should validate with division', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 1,
			}

			const result = schemas.walletJournalRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
		})

		it('should validate without division', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			const result = schemas.walletJournalRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
		})

		it('should reject invalid division', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 8, // Only 1-7 are valid
			}

			const result = schemas.walletJournalRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it('should reject division 0', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 0,
			}

			const result = schemas.walletJournalRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})
	})

	describe('walletTransactionsRefreshMessageSchema', () => {
		it('should validate with division', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 7,
			}

			const result = schemas.walletTransactionsRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
		})

		it('should validate without division', () => {
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			const result = schemas.walletTransactionsRefreshMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
		})
	})

	describe('All schemas', () => {
		const allSchemas = [
			{ name: 'public', schema: schemas.publicRefreshMessageSchema },
			{ name: 'members', schema: schemas.membersRefreshMessageSchema },
			{ name: 'memberTracking', schema: schemas.memberTrackingRefreshMessageSchema },
			{ name: 'wallets', schema: schemas.walletsRefreshMessageSchema },
			{ name: 'walletJournal', schema: schemas.walletJournalRefreshMessageSchema },
			{
				name: 'walletTransactions',
				schema: schemas.walletTransactionsRefreshMessageSchema,
			},
			{ name: 'assets', schema: schemas.assetsRefreshMessageSchema },
			{ name: 'structures', schema: schemas.structuresRefreshMessageSchema },
			{ name: 'orders', schema: schemas.ordersRefreshMessageSchema },
			{ name: 'contracts', schema: schemas.contractsRefreshMessageSchema },
			{ name: 'industryJobs', schema: schemas.industryJobsRefreshMessageSchema },
			{ name: 'killmails', schema: schemas.killmailsRefreshMessageSchema },
		]

		allSchemas.forEach(({ name, schema }) => {
			it(`${name} schema should validate valid message`, () => {
				const message = {
					corporationId: '98000001',
					timestamp: Date.now(),
					requesterId: 'test-system',
				}

				const result = schema.safeParse(message)
				expect(result.success).toBe(true)
			})

			it(`${name} schema should reject missing corporationId`, () => {
				const message = {
					timestamp: Date.now(),
				}

				const result = schema.safeParse(message)
				expect(result.success).toBe(false)
			})

			it(`${name} schema should reject missing timestamp`, () => {
				const message = {
					corporationId: '98000001',
				}

				const result = schema.safeParse(message)
				expect(result.success).toBe(false)
			})
		})
	})
})
