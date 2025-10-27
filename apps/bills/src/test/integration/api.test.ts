import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'
import { withNeonTestBranch } from '../setup'

import type { Bills } from '@repo/bills'

beforeAll(() => {
	withNeonTestBranch()
})

describe('Bills Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Bills')
	})
})

describe('Bills Durable Object RPC', () => {
	const TEST_USER_ID = 'test-user-123'
	const TEST_PAYER_ID = 'test-payer-456'

	it('can create a bill', async () => {
		const stub = getStub<Bills>(env.BILLS, 'default')

		const bill = await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'Test Bill',
			description: 'Test bill description',
			amount: '1000000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
		})

		expect(bill).toBeDefined()
		expect(bill.id).toBeDefined()
		expect(bill.issuerId).toBe(TEST_USER_ID)
		expect(bill.payerId).toBe(TEST_PAYER_ID)
		expect(bill.title).toBe('Test Bill')
		expect(bill.amount).toBe('1000000')
		expect(bill.status).toBe('draft')
		expect(bill.paymentToken).toBeDefined()
	})

	it('can issue a bill', async () => {
		const stub = getStub<Bills>(env.BILLS, 'default')

		// Create a draft bill first
		const draftBill = await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'Bill to Issue',
			description: 'Test issuing',
			amount: '500000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		})

		// Issue the bill
		const issuedBill = await stub.issueBill(TEST_USER_ID, draftBill.id)

		expect(issuedBill.status).toBe('issued')
		expect(issuedBill.id).toBe(draftBill.id)
	})

	it('can get a bill', async () => {
		const stub = getStub<Bills>(env.BILLS, 'default')

		// Create a bill
		const createdBill = await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'Bill to Retrieve',
			description: 'Test retrieval',
			amount: '250000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		})

		// Retrieve the bill
		const retrievedBill = await stub.getBill(TEST_USER_ID, createdBill.id)

		expect(retrievedBill).toBeDefined()
		expect(retrievedBill?.id).toBe(createdBill.id)
		expect(retrievedBill?.title).toBe('Bill to Retrieve')
	})

	it('can list bills', async () => {
		const stub = getStub<Bills>(env.BILLS, 'default')

		// Create multiple bills
		await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'List Test Bill 1',
			description: 'Test 1',
			amount: '100000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		})

		await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'List Test Bill 2',
			description: 'Test 2',
			amount: '200000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		})

		// List bills
		const bills = await stub.listBills(TEST_USER_ID)

		expect(Array.isArray(bills)).toBe(true)
		expect(bills.length).toBeGreaterThanOrEqual(2)
	})

	it('can pay a bill using payment token', async () => {
		const stub = getStub<Bills>(env.BILLS, 'default')

		// Create and issue a bill
		const bill = await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'Bill to Pay',
			description: 'Test payment',
			amount: '750000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		})

		await stub.issueBill(TEST_USER_ID, bill.id)

		// Pay the bill using payment token
		const paymentResponse = await stub.payBill(bill.paymentToken)

		expect(paymentResponse).toBeDefined()
		expect(paymentResponse.success).toBe(true)
		expect(paymentResponse.bill.status).toBe('paid')
		expect(paymentResponse.bill.id).toBe(bill.id)
	})

	it('can cancel a bill', async () => {
		const stub = getStub<Bills>(env.BILLS, 'default')

		// Create a bill
		const bill = await stub.createBill(TEST_USER_ID, {
			payerId: TEST_PAYER_ID,
			payerType: 'character',
			title: 'Bill to Cancel',
			description: 'Test cancellation',
			amount: '300000',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
		})

		// Cancel the bill
		const cancelledBill = await stub.cancelBill(TEST_USER_ID, bill.id)

		expect(cancelledBill.status).toBe('cancelled')
		expect(cancelledBill.id).toBe(bill.id)
	})
})
