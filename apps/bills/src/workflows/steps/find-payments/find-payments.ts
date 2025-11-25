import {
	CharacterWalletJournalEntry,
	CorporationWalletJournalEntry,
	getEsiInstanceForCharacter,
	getEsiInstanceForCorporation,
} from '@repo/esi'

import { getWorkflowLogger } from '../../context'

import type { bills } from '../../../db/schema'
import type { WorkflowContext } from '../../context'

export interface FoundPaymentTransactionsResult {
	paymentTransactions: CharacterWalletJournalEntry[] | CorporationWalletJournalEntry[] | null
	paymentTransactionDestination: 'character' | 'corporation' | null
}

async function findPaymentTransactionsForCharacter(
	ctx: WorkflowContext,
	billData: typeof bills.$inferSelect
): Promise<FoundPaymentTransactionsResult> {
	const logger = getWorkflowLogger(ctx, 'find-payment-transaction-for-character')

	const characterId = billData.payeeId

	logger.info('[Workflow] Finding payment transaction in character wallet journal', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		characterId: characterId,
		paymentToken: billData.paymentToken,
	})

	if (!characterId) {
		throw new Error('Character ID is required')
	}

	const esiStub = getEsiInstanceForCharacter(ctx.env.ESI, characterId)
	const walletTransactions = await esiStub.fetchCharacterWalletJournal(characterId)
	const paymentTransactions = walletTransactions.filter((transaction) =>
		transaction.reason?.toLowerCase().includes(billData.paymentToken.toLowerCase())
	)

	if (paymentTransactions.length === 0) {
		return {
			paymentTransactions: null,
			paymentTransactionDestination: null,
		}
	}

	return {
		paymentTransactions: paymentTransactions,
		paymentTransactionDestination: 'character',
	}
}

async function findPaymentTransactionsForCorporation(
	ctx: WorkflowContext,
	billData: typeof bills.$inferSelect
): Promise<FoundPaymentTransactionsResult> {
	const logger = getWorkflowLogger(ctx, 'find-payment-transaction-for-corporation')

	const corporationId = billData.payeeId

	logger.info('[Workflow] Finding payment transaction in corporation wallet journal', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		corporationId: corporationId,
		paymentToken: billData.paymentToken,
	})

	if (!corporationId) {
		throw new Error('Corporation ID is required')
	}

	const esiStub = getEsiInstanceForCorporation(ctx.env.ESI, corporationId)

	const paymentTransactions: CorporationWalletJournalEntry[] = []
	for (const division of Array.from({ length: 7 }, (_, i) => i + 1)) {
		const walletTransactions = await esiStub.fetchCorporationWalletJournal(corporationId, division)
		logger.info('[Workflow] Found payment transactions for corporation', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			corporationId: corporationId,
			division: division,
			walletTransactions: walletTransactions.length,
		})
		paymentTransactions.push(
			...walletTransactions.filter((transaction) =>
				transaction.reason?.toLowerCase().includes(billData.paymentToken.toLowerCase())
			)
		)
	}

	if (paymentTransactions.length === 0) {
		return {
			paymentTransactions: null,
			paymentTransactionDestination: null,
		}
	}

	return {
		paymentTransactions: paymentTransactions,
		paymentTransactionDestination: 'corporation',
	}
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

	const payeeId = billData.payeeId
	const payeeType = billData.payeeType

	if (!payeeId || !payeeType) {
		throw new Error('Payee ID and type are required')
	}

	if (payeeType === 'character') {
		const result = await findPaymentTransactionsForCharacter(ctx, billData)
		if (!result.paymentTransactions) {
			logger.info('[Workflow] No payment transactions found for character', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				characterId: billData.payeeId,
				paymentToken: billData.paymentToken,
			})
			return
		}
		for (const paymentTransaction of result.paymentTransactions) {
			await ctx.billService.payBill(billData.paymentToken, {
				amount: BigInt(paymentTransaction.amount!),
				paidById: paymentTransaction.first_party_id!,
				paidByType: 'character',
				esiTransactionId: paymentTransaction.id,
			})
		}
	} else if (payeeType === 'corporation') {
		const result = await findPaymentTransactionsForCorporation(ctx, billData)
		if (!result.paymentTransactions) {
			logger.info('[Workflow] No payment transactions found for corporation', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				corporationId: billData.payeeId,
				paymentToken: billData.paymentToken,
			})
			return
		}
		for (const paymentTransaction of result.paymentTransactions) {
			await ctx.billService.payBill(billData.paymentToken, {
				amount: BigInt(paymentTransaction.amount!),
				paidById: paymentTransaction.first_party_id!,
				paidByType: 'corporation',
				esiTransactionId: paymentTransaction.id,
			})
		}
	} else {
		throw new Error('Invalid payee type')
	}
}
