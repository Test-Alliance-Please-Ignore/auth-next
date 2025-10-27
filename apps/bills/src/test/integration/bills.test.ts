import { env, runInDurableObject, SELF } from 'cloudflare:test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import { testBranchManager } from '../setup'

import type { Bills, CreateBillInput } from '@repo/bills'
import type { BillsDO } from '../../durable-object'

describe('Bills Integration Tests', () => {
	const TEST_USER_ID = 'test-user-123'
	const TEST_PAYER_ID = 'test-payer-456'

	describe('Bill Lifecycle', () => {
		it('should create a draft bill', async () => {
			const billData: CreateBillInput = {
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				title: 'Test Bill',
				description: 'This is a test bill',
				amount: '1000000',
				dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
			}

			const billsStub = env.BILLS.getByName('default')

			await runInDurableObject(billsStub, async (instance: BillsDO) => {
				console.log('Updating db to:', env.DATABASE_URL)
				console.log('instance', instance)
				const bill = await instance.createBill(TEST_USER_ID, billData)
				expect(bill).toBeDefined()
				expect(bill.id).toBeTruthy()
			})
			// console.log('billsStub', billsStub)
			// console.log('env.DATABASE_URL', env.DATABASE_URL)
			// billsStub.updateDb(env.DATABASE_URL)
			// const bill = await billsStub.createBill(TEST_USER_ID, billData)
			// expect(bill).toBeDefined()
			// expect(bill.id).toBeTruthy()
		})

		// 	it('should issue a draft bill', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Bill to Issue',
		// 			amount: '500000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		const issuedBill = await billsStub.issueBill(TEST_USER_ID, bill.id)

		// 		expect(issuedBill.status).toBe('issued')
		// 		expect(issuedBill.id).toBe(bill.id)
		// 	})

		// 	it('should pay a bill with valid payment token', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Bill to Pay',
		// 			amount: '750000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		await billsStub.issueBill(TEST_USER_ID, bill.id)

		// 		const paymentResponse = await billsStub.payBill(bill.paymentToken)

		// 		expect(paymentResponse.success).toBe(true)
		// 		expect(paymentResponse.bill.status).toBe('paid')
		// 		expect(paymentResponse.bill.paidAt).toBeTruthy()
		// 	})

		// 	it('should not pay a draft bill', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Draft Bill',
		// 			amount: '250000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		const paymentResponse = await billsStub.payBill(bill.paymentToken)

		// 		expect(paymentResponse.success).toBe(false)
		// 		expect(paymentResponse.message).toContain('not been issued')
		// 	})

		// 	it('should cancel an issued bill', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Bill to Cancel',
		// 			amount: '300000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		await billsStub.issueBill(TEST_USER_ID, bill.id)
		// 		const cancelledBill = await billsStub.cancelBill(TEST_USER_ID, bill.id)

		// 		expect(cancelledBill.status).toBe('cancelled')
		// 	})
		// })

		// describe('Late Fees', () => {
		// 	it('should calculate static late fees with daily compounding', async () => {
		// 		// Create overdue bill
		// 		const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago

		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Overdue Bill with Static Fees',
		// 			amount: '1000000',
		// 			dueDate: pastDate,
		// 			lateFeeType: 'static',
		// 			lateFeeAmount: '10000', // 10k ISK per day
		// 			lateFeeCompounding: 'daily',
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		await billsStub.issueBill(TEST_USER_ID, bill.id)

		// 		// Fetch bill to trigger late fee calculation
		// 		const fetchedBill = await billsStub.getBill(TEST_USER_ID, bill.id)

		// 		expect(fetchedBill?.status).toBe('overdue')
		// 		// Should be ~30k (10k * 3 days)
		// 		const lateFee = parseFloat(fetchedBill?.lateFee || '0')
		// 		expect(lateFee).toBeGreaterThan(25000)
		// 		expect(lateFee).toBeLessThan(35000)
		// 	})

		// 	it('should calculate percentage late fees with monthly compounding', async () => {
		// 		// Create overdue bill (35 days overdue = 1 month)
		// 		const pastDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)

		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Overdue Bill with Percentage Fees',
		// 			amount: '1000000',
		// 			dueDate: pastDate,
		// 			lateFeeType: 'percentage',
		// 			lateFeeAmount: '10', // 10% per month
		// 			lateFeeCompounding: 'monthly',
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		await billsStub.issueBill(TEST_USER_ID, bill.id)

		// 		const fetchedBill = await billsStub.getBill(TEST_USER_ID, bill.id)

		// 		expect(fetchedBill?.status).toBe('overdue')
		// 		// Should be 100k (10% of 1M for 1 month)
		// 		const lateFee = parseFloat(fetchedBill?.lateFee || '0')
		// 		expect(lateFee).toBeGreaterThan(90000)
		// 		expect(lateFee).toBeLessThan(110000)
		// 	})
		// })

		// describe('Authorization', () => {
		// 	it('should only allow issuer to update bill', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Auth Test Bill',
		// 			amount: '500000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)

		// 		await expect(
		// 			billsStub.updateBill('different-user', bill.id, { title: 'Hacked Title' })
		// 		).rejects.toThrow('Only the issuer can update')
		// 	})

		// 	it('should only allow issuer to view their bills', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Private Bill',
		// 			amount: '200000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)

		// 		await expect(billsStub.getBill('different-user', bill.id)).rejects.toThrow('Not authorized')
		// 	})

		// 	it('should allow payer to view their bills', async () => {
		// 		const billData: CreateBillInput = {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Payer Viewable Bill',
		// 			amount: '150000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		}

		// 		const bill = await billsStub.createBill(TEST_USER_ID, billData)
		// 		const fetchedBill = await billsStub.getBill(TEST_PAYER_ID, bill.id)

		// 		expect(fetchedBill).toBeDefined()
		// 		expect(fetchedBill?.id).toBe(bill.id)
		// 	})
		// })

		// describe('Bill Statistics', () => {
		// 	it('should calculate bill statistics correctly', async () => {
		// 		// Create multiple bills with different statuses
		// 		const bill1 = await billsStub.createBill(TEST_USER_ID, {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Bill 1',
		// 			amount: '1000000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		})

		// 		await billsStub.issueBill(TEST_USER_ID, bill1.id)

		// 		const bill2 = await billsStub.createBill(TEST_USER_ID, {
		// 			payerId: TEST_PAYER_ID,
		// 			payerType: 'character',
		// 			title: 'Bill 2',
		// 			amount: '500000',
		// 			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		// 		})

		// 		await billsStub.issueBill(TEST_USER_ID, bill2.id)
		// 		await billsStub.payBill(bill2.paymentToken)

		// 		const stats = await billsStub.getBillStatistics(TEST_USER_ID)

		// 		expect(stats.totalBills).toBeGreaterThanOrEqual(2)
		// 		expect(stats.billsByStatus.issued).toBeGreaterThanOrEqual(1)
		// 		expect(stats.billsByStatus.paid).toBeGreaterThanOrEqual(1)
		// 	})
		// })
	})
})
