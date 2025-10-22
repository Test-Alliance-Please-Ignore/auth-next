import { describe, expect, it, vi } from 'vitest'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import * as handlers from '../handlers'

describe('Queue Handlers', () => {
	const createMockStub = () => {
		return {
			fetchPublicData: vi.fn(),
			fetchCoreData: vi.fn(),
			fetchFinancialData: vi.fn(),
			fetchAssetsData: vi.fn(),
			fetchMarketData: vi.fn(),
			fetchKillmails: vi.fn(),
		} as unknown as EveCorporationData
	}

	describe('handlePublicRefresh', () => {
		it('should call fetchPublicData', async () => {
			const stub = createMockStub()
			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handlePublicRefresh(stub, message)

			expect(stub.fetchPublicData).toHaveBeenCalledOnce()
		})
	})

	describe('handleMembersRefresh', () => {
		it('should call fetchCoreData and succeed when members data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchCoreData).mockResolvedValue({
				members: { data: [] },
				memberTracking: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleMembersRefresh(stub, message)

			expect(stub.fetchCoreData).toHaveBeenCalledOnce()
		})

		it('should throw when members data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchCoreData).mockResolvedValue({
				members: null,
				memberTracking: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleMembersRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch members data'
			)
		})
	})

	describe('handleMemberTrackingRefresh', () => {
		it('should call fetchCoreData and succeed when member tracking data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchCoreData).mockResolvedValue({
				members: null,
				memberTracking: { data: [] },
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleMemberTrackingRefresh(stub, message)

			expect(stub.fetchCoreData).toHaveBeenCalledOnce()
		})

		it('should throw when member tracking data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchCoreData).mockResolvedValue({
				members: null,
				memberTracking: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleMemberTrackingRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch member tracking data'
			)
		})
	})

	describe('handleWalletsRefresh', () => {
		it('should fetch all 7 divisions in parallel', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: { balance: 1000000 },
				journal: null,
				transactions: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleWalletsRefresh(stub, message)

			expect(stub.fetchFinancialData).toHaveBeenCalledTimes(7)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(1)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(2)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(3)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(4)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(5)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(6)
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(7)
		})

		it('should succeed if at least one division succeeds', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockImplementation((division) => {
				// Only division 1 succeeds
				if (division === 1) {
					return Promise.resolve({
						wallets: { balance: 1000000 },
						journal: null,
						transactions: null,
					})
				}
				return Promise.reject(new Error('Failed'))
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleWalletsRefresh(stub, message)).resolves.toBeUndefined()
		})

		it('should throw when all divisions fail', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockRejectedValue(new Error('Failed'))

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleWalletsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch wallet data for any division'
			)
		})
	})

	describe('handleWalletJournalRefresh', () => {
		it('should fetch specific division when division is provided', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: null,
				journal: { data: [] },
				transactions: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 3,
			}

			await handlers.handleWalletJournalRefresh(stub, message)

			expect(stub.fetchFinancialData).toHaveBeenCalledOnce()
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(3)
		})

		it('should throw when specific division fails', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: null,
				journal: null,
				transactions: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 3,
			}

			await expect(handlers.handleWalletJournalRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch wallet journal for division 3'
			)
		})

		it('should fetch all 7 divisions when division is not provided', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: null,
				journal: { data: [] },
				transactions: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleWalletJournalRefresh(stub, message)

			expect(stub.fetchFinancialData).toHaveBeenCalledTimes(7)
		})

		it('should throw when all divisions fail', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockRejectedValue(new Error('Failed'))

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleWalletJournalRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch wallet journal for any division'
			)
		})
	})

	describe('handleWalletTransactionsRefresh', () => {
		it('should fetch specific division when division is provided', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: null,
				journal: null,
				transactions: { data: [] },
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 5,
			}

			await handlers.handleWalletTransactionsRefresh(stub, message)

			expect(stub.fetchFinancialData).toHaveBeenCalledOnce()
			expect(stub.fetchFinancialData).toHaveBeenCalledWith(5)
		})

		it('should throw when specific division fails', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: null,
				journal: null,
				transactions: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
				division: 5,
			}

			await expect(handlers.handleWalletTransactionsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch wallet transactions for division 5'
			)
		})

		it('should fetch all 7 divisions when division is not provided', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockResolvedValue({
				wallets: null,
				journal: null,
				transactions: { data: [] },
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleWalletTransactionsRefresh(stub, message)

			expect(stub.fetchFinancialData).toHaveBeenCalledTimes(7)
		})

		it('should throw when all divisions fail', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchFinancialData).mockRejectedValue(new Error('Failed'))

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleWalletTransactionsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch wallet transactions for any division'
			)
		})
	})

	describe('handleAssetsRefresh', () => {
		it('should call fetchAssetsData and succeed when assets data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchAssetsData).mockResolvedValue({
				assets: { data: [] },
				structures: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleAssetsRefresh(stub, message)

			expect(stub.fetchAssetsData).toHaveBeenCalledOnce()
		})

		it('should throw when assets data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchAssetsData).mockResolvedValue({
				assets: null,
				structures: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleAssetsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch assets data'
			)
		})
	})

	describe('handleStructuresRefresh', () => {
		it('should call fetchAssetsData and succeed when structures data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchAssetsData).mockResolvedValue({
				assets: null,
				structures: { data: [] },
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleStructuresRefresh(stub, message)

			expect(stub.fetchAssetsData).toHaveBeenCalledOnce()
		})

		it('should throw when structures data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchAssetsData).mockResolvedValue({
				assets: null,
				structures: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleStructuresRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch structures data'
			)
		})
	})

	describe('handleOrdersRefresh', () => {
		it('should call fetchMarketData and succeed when orders data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchMarketData).mockResolvedValue({
				orders: { data: [] },
				contracts: null,
				industryJobs: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleOrdersRefresh(stub, message)

			expect(stub.fetchMarketData).toHaveBeenCalledOnce()
		})

		it('should throw when orders data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchMarketData).mockResolvedValue({
				orders: null,
				contracts: null,
				industryJobs: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleOrdersRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch orders data'
			)
		})
	})

	describe('handleContractsRefresh', () => {
		it('should call fetchMarketData and succeed when contracts data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchMarketData).mockResolvedValue({
				orders: null,
				contracts: { data: [] },
				industryJobs: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleContractsRefresh(stub, message)

			expect(stub.fetchMarketData).toHaveBeenCalledOnce()
		})

		it('should throw when contracts data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchMarketData).mockResolvedValue({
				orders: null,
				contracts: null,
				industryJobs: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleContractsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch contracts data'
			)
		})
	})

	describe('handleIndustryJobsRefresh', () => {
		it('should call fetchMarketData and succeed when industry jobs data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchMarketData).mockResolvedValue({
				orders: null,
				contracts: null,
				industryJobs: { data: [] },
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleIndustryJobsRefresh(stub, message)

			expect(stub.fetchMarketData).toHaveBeenCalledOnce()
		})

		it('should throw when industry jobs data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchMarketData).mockResolvedValue({
				orders: null,
				contracts: null,
				industryJobs: null,
			})

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleIndustryJobsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch industry jobs data'
			)
		})
	})

	describe('handleKillmailsRefresh', () => {
		it('should call fetchKillmails and succeed when data exists', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchKillmails).mockResolvedValue({ data: [] })

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await handlers.handleKillmailsRefresh(stub, message)

			expect(stub.fetchKillmails).toHaveBeenCalledOnce()
		})

		it('should throw when killmails data is missing', async () => {
			const stub = createMockStub()
			vi.mocked(stub.fetchKillmails).mockResolvedValue(null)

			const message = {
				corporationId: '98000001',
				timestamp: Date.now(),
			}

			await expect(handlers.handleKillmailsRefresh(stub, message)).rejects.toThrow(
				'Failed to fetch killmails data'
			)
		})
	})
})
