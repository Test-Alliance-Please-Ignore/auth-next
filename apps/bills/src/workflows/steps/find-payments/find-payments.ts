import { sql } from '@repo/db-utils'

import { getWorkflowLogger } from '../../context'

import type { bills } from '../../../db/schema'
import type { WorkflowContext } from '../../context'

type CorporationWalletPaymentRow = {
	journalId: string
	amount: string
	firstPartyId: string | null
	entryDate: Date
}

type CharacterWalletPaymentRow = {
	journalId: string
	amount: string
	firstPartyId: string | null
	entryDate: Date
}

function parseAmountToBigInt(rawAmount: string): bigint | null {
	const normalized = rawAmount.trim()
	if (!normalized) {
		return null
	}

	if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
		return null
	}

	const integerPart = normalized.split('.')[0]
	if (!/^-?\d+$/.test(integerPart)) {
		return null
	}

	try {
		return BigInt(integerPart)
	} catch {
		return null
	}
}

async function findPaymentTransactionsForCorporationFromDb(
	ctx: WorkflowContext,
	billData: typeof bills.$inferSelect
): Promise<CorporationWalletPaymentRow[]> {
	const logger = getWorkflowLogger(ctx, 'find-payment-transaction-for-corporation-db')

	const corporationId = billData.payeeId

	logger.info('[Workflow] Finding payment transaction in persisted corporation wallet journal', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		corporationId: corporationId,
		paymentToken: billData.paymentToken,
		fromDate: billData.createdAt,
	})

	if (!corporationId) {
		throw new Error('Corporation ID is required')
	}

	const tokenNeedle = `%${billData.paymentToken.toLowerCase()}%`
	const results = await ctx.db.execute<CorporationWalletPaymentRow>(
		sql`select
			journal_id::text as "journalId",
			amount as "amount",
			first_party_id as "firstPartyId",
			date as "entryDate"
		from corporation_wallet_journal
		where corporation_id = ${corporationId}
			and date >= ${billData.createdAt}
			and amount::numeric > 0
			and reason is not null
			and lower(reason) like ${tokenNeedle}
		order by date asc
		limit 500`
	)
	return results.rows ?? []
}

async function findPaymentTransactionsForCharacterFromDb(
	ctx: WorkflowContext,
	billData: typeof bills.$inferSelect
): Promise<CharacterWalletPaymentRow[]> {
	const logger = getWorkflowLogger(ctx, 'find-payment-transaction-for-character-db')

	const characterId = billData.payeeId

	logger.info('[Workflow] Finding payment transaction in persisted character wallet journal', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		characterId,
		paymentToken: billData.paymentToken,
		fromDate: billData.createdAt,
	})

	if (!characterId) {
		throw new Error('Character ID is required')
	}

	const tokenNeedle = `%${billData.paymentToken.toLowerCase()}%`
	const results = await ctx.db.execute<CharacterWalletPaymentRow>(
		sql`select
			journal_id::text as "journalId",
			amount as "amount",
			first_party_id as "firstPartyId",
			date as "entryDate"
		from character_wallet_journal
		where character_id = ${characterId}
			and date >= ${billData.createdAt}
			and amount::numeric > 0
			and reason is not null
			and lower(reason) like ${tokenNeedle}
		order by date asc
		limit 500`
	)
	return results.rows ?? []
}

export async function findPaymentsForBill(
	ctx: WorkflowContext,
	billData: typeof bills.$inferSelect
): Promise<void> {
	const logger = getWorkflowLogger(ctx, 'check-character-payment-status')

	logger.info('[Workflow] Checking payment status for bill', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		payeeId: billData.payeeId,
		payeeType: billData.payeeType,
	})

	const payeeType = billData.payeeType

	if (!payeeType) {
		throw new Error('Payee type is required')
	}

	if (payeeType === 'corporation') {
		const paymentTransactions = await findPaymentTransactionsForCorporationFromDb(ctx, billData)
		if (paymentTransactions.length === 0) {
			logger.info('[Workflow] No payment transactions found for corporation in persisted data', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				corporationId: billData.payeeId,
				paymentToken: billData.paymentToken,
				fromDate: billData.createdAt,
			})
			return
		}
		for (const paymentTransaction of paymentTransactions) {
			const amount = parseAmountToBigInt(paymentTransaction.amount)
			if (amount === null || amount <= 0n) {
				logger.warn('[Workflow] Skipping corporation payment transaction with invalid amount', {
					billId: ctx.billId,
					workflowInstanceId: ctx.workflowInstanceId,
					journalId: paymentTransaction.journalId,
					amount: paymentTransaction.amount,
				})
				continue
			}
			if (!paymentTransaction.firstPartyId) {
				logger.warn('[Workflow] Skipping corporation payment transaction with missing payer id', {
					billId: ctx.billId,
					workflowInstanceId: ctx.workflowInstanceId,
					journalId: paymentTransaction.journalId,
				})
				continue
			}
			await ctx.billService.payBill(billData.paymentToken, {
				amount,
				paidById: paymentTransaction.firstPartyId,
				paidByType: 'corporation',
				esiTransactionId: paymentTransaction.journalId,
			})
		}
		logger.info('[Workflow] Processed corporation payment transactions from persisted data', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			corporationId: billData.payeeId,
			count: paymentTransactions.length,
		})
		return
	}

	if (payeeType === 'character') {
		const paymentTransactions = await findPaymentTransactionsForCharacterFromDb(ctx, billData)
		if (paymentTransactions.length === 0) {
			logger.info('[Workflow] No payment transactions found for character in persisted data', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				characterId: billData.payeeId,
				paymentToken: billData.paymentToken,
				fromDate: billData.createdAt,
			})
			return
		}

		for (const paymentTransaction of paymentTransactions) {
			const amount = parseAmountToBigInt(paymentTransaction.amount)
			if (amount === null || amount <= 0n) {
				logger.warn('[Workflow] Skipping character payment transaction with invalid amount', {
					billId: ctx.billId,
					workflowInstanceId: ctx.workflowInstanceId,
					journalId: paymentTransaction.journalId,
					amount: paymentTransaction.amount,
				})
				continue
			}
			if (!paymentTransaction.firstPartyId) {
				logger.warn('[Workflow] Skipping character payment transaction with missing payer id', {
					billId: ctx.billId,
					workflowInstanceId: ctx.workflowInstanceId,
					journalId: paymentTransaction.journalId,
				})
				continue
			}
			await ctx.billService.payBill(billData.paymentToken, {
				amount,
				paidById: paymentTransaction.firstPartyId,
				paidByType: billData.payerType ?? 'character',
				esiTransactionId: paymentTransaction.journalId,
			})
		}

		logger.info('[Workflow] Processed character payment transactions from persisted data', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			characterId: billData.payeeId,
			count: paymentTransactions.length,
		})
		return
	} else {
		logger.info('[Workflow] Skipping payment transaction lookup for unsupported payee type', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			payeeType,
		})
	}
}
