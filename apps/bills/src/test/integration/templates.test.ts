import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import { createDb } from '../../db'
import { withNeonTestBranch } from '../setup'

import type { Bills, CreateBillFromTemplateInput, CreateTemplateInput } from '@repo/bills'

beforeAll(() => {
	withNeonTestBranch()
})

describe('Templates Integration Tests', () => {
	let db: ReturnType<typeof createDb>
	let billsStub: Bills
	const TEST_USER_ID = 'test-user-123'
	const TEST_PAYER_ID = 'test-payer-456'

	beforeAll(async () => {
		if (!env.DATABASE_URL) {
			throw new Error('DATABASE_URL is not set')
		}

		const db = createDb(env.DATABASE_URL!)
		// Create mock stub for testing
		const { TemplateService } = await import('../../services/template.service')
		const { BillService } = await import('../../services/bill.service')
		const templateService = new TemplateService(db)
		const billService = new BillService(db)

		billsStub = {
			createTemplate: (userId: string, data: CreateTemplateInput) =>
				templateService.createTemplate(userId, data),
			getTemplate: (userId: string, templateId: string) =>
				templateService.getTemplate(userId, templateId),
			listTemplates: (userId: string) => templateService.listTemplates(userId),
			updateTemplate: (userId: string, templateId: string, data: any) =>
				templateService.updateTemplate(userId, templateId, data),
			deleteTemplate: (userId: string, templateId: string) =>
				templateService.deleteTemplate(userId, templateId),
			cloneTemplate: (userId: string, data: any) => templateService.cloneTemplate(userId, data),
			cloneBillAsTemplate: (userId: string, data: any) =>
				templateService.cloneBillAsTemplate(userId, data),
			createBillFromTemplate: (userId: string, data: CreateBillFromTemplateInput) =>
				templateService.createBillFromTemplate(userId, data),
			createBill: (userId: string, data: any) => billService.createBill(userId, data),
		} as any
	})

	describe('Template CRUD', () => {
		it('should create a template', async () => {
			const templateData: CreateTemplateInput = {
				name: 'Monthly Rent',
				description: 'Standard monthly rent template',
				titleTemplate: 'Rent Payment for {month}',
				descriptionTemplate: 'Monthly rent for {location}',
				amountTemplate: '{amount}',
				lateFeeType: 'percentage',
				lateFeeAmount: '5',
				lateFeeCompounding: 'daily',
				daysUntilDue: 7,
			}

			const template = await billsStub.createTemplate(TEST_USER_ID, templateData)

			expect(template).toBeDefined()
			expect(template.id).toBeTruthy()
			expect(template.ownerId).toBe(TEST_USER_ID)
			expect(template.name).toBe('Monthly Rent')
			expect(template.titleTemplate).toBe('Rent Payment for {month}')
			expect(template.lateFeeType).toBe('percentage')
		})

		it('should list templates for a user', async () => {
			await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Template 1',
				titleTemplate: 'Test Template 1',
			})

			await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Template 2',
				titleTemplate: 'Test Template 2',
			})

			const templates = await billsStub.listTemplates(TEST_USER_ID)

			expect(templates.length).toBeGreaterThanOrEqual(2)
		})

		it('should update a template', async () => {
			const template = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Original Name',
				titleTemplate: 'Original Title',
			})

			const updated = await billsStub.updateTemplate(TEST_USER_ID, template.id, {
				name: 'Updated Name',
			})

			expect(updated.name).toBe('Updated Name')
			expect(updated.titleTemplate).toBe('Original Title')
		})

		it('should delete a template', async () => {
			const template = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Deletable Template',
				titleTemplate: 'Delete Me',
			})

			await billsStub.deleteTemplate(TEST_USER_ID, template.id)

			await expect(billsStub.getTemplate(TEST_USER_ID, template.id)).resolves.toBeNull()
		})
	})

	describe('Template Cloning', () => {
		it('should clone an existing template', async () => {
			const originalTemplate = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Original Template',
				titleTemplate: 'Original Title {param}',
				descriptionTemplate: 'Original Description',
				lateFeeType: 'static',
				lateFeeAmount: '10000',
				daysUntilDue: 14,
			})

			const clonedTemplate = await billsStub.cloneTemplate(TEST_USER_ID, {
				sourceTemplateId: originalTemplate.id,
				name: 'Cloned Template',
				description: 'Cloned from original',
			})

			expect(clonedTemplate.id).not.toBe(originalTemplate.id)
			expect(clonedTemplate.name).toBe('Cloned Template')
			expect(clonedTemplate.titleTemplate).toBe('Original Title {param}')
			expect(clonedTemplate.lateFeeType).toBe('static')
			expect(clonedTemplate.daysUntilDue).toBe(14)
		})

		it('should clone a bill as a template', async () => {
			const bill = await billsStub.createBill(TEST_USER_ID, {
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				title: 'One-Time Bill',
				description: 'Special payment',
				amount: '5000000',
				dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
				lateFeeType: 'percentage',
				lateFeeAmount: '2.5',
				lateFeeCompounding: 'monthly',
			})

			const template = await billsStub.cloneBillAsTemplate(TEST_USER_ID, {
				sourceBillId: bill.id,
				name: 'Template from Bill',
				description: 'Created from a bill',
			})

			expect(template).toBeDefined()
			expect(template.name).toBe('Template from Bill')
			expect(template.titleTemplate).toBe('One-Time Bill')
			expect(template.lateFeeType).toBe('percentage')
		})
	})

	describe('Bill Creation from Template', () => {
		it('should create a bill from template with parameter substitution', async () => {
			const template = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Parameterized Template',
				titleTemplate: 'Payment for {service} - {month}',
				descriptionTemplate: 'Invoice for {service} services provided in {month}',
				daysUntilDue: 7,
			})

			const bill = await billsStub.createBillFromTemplate(TEST_USER_ID, {
				templateId: template.id,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				amount: '2500000',
				templateParams: {
					service: 'Mining',
					month: 'January 2025',
				},
			})

			expect(bill).toBeDefined()
			expect(bill.title).toBe('Payment for Mining - January 2025')
			expect(bill.description).toBe('Invoice for Mining services provided in January 2025')
			expect(bill.amount).toBe('2500000')
			expect(bill.status).toBe('draft')
			expect(bill.templateId).toBe(template.id)

			// Check due date is set correctly (7 days from now)
			const now = new Date()
			const expectedDue = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
			const dueDate = new Date(bill.dueDate)

			// Allow 1 minute difference for test execution time
			expect(Math.abs(dueDate.getTime() - expectedDue.getTime())).toBeLessThan(60000)
		})

		it('should inherit late fee settings from template', async () => {
			const template = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Late Fee Template',
				titleTemplate: 'Bill with Late Fees',
				lateFeeType: 'static',
				lateFeeAmount: '50000',
				lateFeeCompounding: 'weekly',
				daysUntilDue: 14,
			})

			const bill = await billsStub.createBillFromTemplate(TEST_USER_ID, {
				templateId: template.id,
				payerId: TEST_PAYER_ID,
				payerType: 'character',
				amount: '1000000',
			})

			expect(bill.lateFeeType).toBe('static')
			expect(bill.lateFeeAmount).toBe('50000')
			expect(bill.lateFeeCompounding).toBe('weekly')
		})
	})

	describe('Template Authorization', () => {
		it('should only allow owner to update template', async () => {
			const template = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Private Template',
				titleTemplate: 'Private',
			})

			await expect(
				billsStub.updateTemplate('different-user', template.id, { name: 'Hacked' })
			).rejects.toThrow('Only the owner can update')
		})

		it('should only allow owner to delete template', async () => {
			const template = await billsStub.createTemplate(TEST_USER_ID, {
				name: 'Protected Template',
				titleTemplate: 'Protected',
			})

			await expect(billsStub.deleteTemplate('different-user', template.id)).rejects.toThrow(
				'Only the owner can delete'
			)
		})
	})
})
