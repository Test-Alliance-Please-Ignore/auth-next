import { sql } from '@repo/db-utils'

import { getWorkflowLogger } from '../../context'

import type { WalletPaymentInput } from '../../../services/bill.service'
import type { WorkflowContext } from '../../context'
import type { BillPaymentCheckData } from '../fetch-bill-data'

const PAYMENT_BATCH_SIZE = 100
const PAYMENT_LOOKBEHIND_MS = 60 * 60 * 1000

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

type WalletPaymentRow = CorporationWalletPaymentRow | CharacterWalletPaymentRow

type PaymentCursor = {
	entryDate: Date
	journalId: string
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

function validatePaymentTransactions(
	ctx: WorkflowContext,
	rows: WalletPaymentRow[],
	paidByType: WalletPaymentInput['paidByType']
): WalletPaymentInput[] {
	const logger = getWorkflowLogger(ctx, 'validate-payment-transactions')
	const payments: WalletPaymentInput[] = []

	for (const paymentTransaction of rows) {
		const amount = parseAmountToBigInt(paymentTransaction.amount)
		if (amount === null || amount <= 0n) {
			logger.warn('[Workflow] Skipping wallet payment transaction with invalid amount', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				journalId: paymentTransaction.journalId,
				amount: paymentTransaction.amount,
			})
			continue
		}
		if (!paymentTransaction.firstPartyId) {
			logger.warn('[Workflow] Skipping wallet payment transaction with missing payer id', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				journalId: paymentTransaction.journalId,
			})
			continue
		}

		payments.push({
			amount,
			paidById: paymentTransaction.firstPartyId,
			paidByType,
			esiTransactionId: paymentTransaction.journalId,
		})
	}

	return payments
}

async function findPaymentTransactionsForCorporationFromDb(
	ctx: WorkflowContext,
	billData: BillPaymentCheckData,
	searchEnd: Date,
	cursor?: PaymentCursor
): Promise<CorporationWalletPaymentRow[]> {
	const logger = getWorkflowLogger(ctx, 'find-payment-transaction-for-corporation-db')

	const corporationId = billData.payeeId

	logger.info('[Workflow] Finding payment transaction in persisted corporation wallet journal', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		corporationId,
		paymentToken: billData.paymentToken,
		fromDate: billData.paymentStartAt,
	})

	if (!corporationId) {
		logger.warn(
			'[Workflow] Skipping corporation payment transaction lookup because corporation ID is missing',
			{
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
			}
		)
		return []
	}

	const tokenPrefix = `${billData.paymentToken}%`
	const paymentSearchStart = getPaymentSearchStart(billData)
	const cursorCondition = cursor
		? sql`date > ${cursor.entryDate} or (date = ${cursor.entryDate} and journal_id > ${cursor.journalId})`
		: sql`true`
	const results = await ctx.db.execute<CorporationWalletPaymentRow>(
		sql`select
			journal_id::text as "journalId",
			amount as "amount",
			first_party_id as "firstPartyId",
			date as "entryDate"
		from corporation_wallet_journal
		where corporation_id = ${corporationId}
			and date >= ${paymentSearchStart}
			and date <= ${searchEnd}
			and (${cursorCondition})
			and (
				case
					when amount ~ '^[0-9]+(\\.[0-9]+)?$' then amount::numeric
					else 0
				end
			) > 0
			and first_party_id is not null
			and reason is not null
			and reason like ${tokenPrefix}
			and not exists (
				select 1
				from bill_payments
				where bill_payments.esi_transaction_id = corporation_wallet_journal.journal_id::text
			)
		order by date asc, journal_id asc
		limit ${PAYMENT_BATCH_SIZE}`
	)
	return results.rows ?? []
}

async function findPaymentTransactionsForCharacterFromDb(
	ctx: WorkflowContext,
	billData: BillPaymentCheckData,
	searchEnd: Date,
	cursor?: PaymentCursor
): Promise<CharacterWalletPaymentRow[]> {
	const logger = getWorkflowLogger(ctx, 'find-payment-transaction-for-character-db')

	const characterId = billData.payeeId

	logger.info('[Workflow] Finding payment transaction in persisted character wallet journal', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		characterId,
		paymentToken: billData.paymentToken,
		fromDate: billData.paymentStartAt,
	})

	if (!characterId) {
		logger.warn(
			'[Workflow] Skipping character payment transaction lookup because character ID is missing',
			{
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
			}
		)
		return []
	}

	const tokenPrefix = `${billData.paymentToken}%`
	const paymentSearchStart = getPaymentSearchStart(billData)
	const cursorCondition = cursor
		? sql`date > ${cursor.entryDate} or (date = ${cursor.entryDate} and journal_id > ${cursor.journalId})`
		: sql`true`
	const results = await ctx.db.execute<CharacterWalletPaymentRow>(
		sql`select
			journal_id::text as "journalId",
			amount as "amount",
			first_party_id as "firstPartyId",
			date as "entryDate"
		from character_wallet_journal
		where character_id = ${characterId}
			and date >= ${paymentSearchStart}
			and date <= ${searchEnd}
			and (${cursorCondition})
			and (
				case
					when amount ~ '^[0-9]+(\\.[0-9]+)?$' then amount::numeric
					else 0
				end
			) > 0
			and first_party_id is not null
			and reason is not null
			and reason like ${tokenPrefix}
			and not exists (
				select 1
				from bill_payments
				where bill_payments.esi_transaction_id = character_wallet_journal.journal_id::text
			)
		order by date asc, journal_id asc
		limit ${PAYMENT_BATCH_SIZE}`
	)
	return results.rows ?? []
}

function getPaymentSearchStart(billData: BillPaymentCheckData): Date {
	const paymentStartAt = new Date(billData.paymentStartAt)
	const lastCheckedAt = billData.paymentLastCheckedAt
		? new Date(billData.paymentLastCheckedAt).getTime() - PAYMENT_LOOKBEHIND_MS
		: paymentStartAt.getTime()

	return new Date(Math.max(paymentStartAt.getTime(), lastCheckedAt))
}

function getPaymentCursor(row: WalletPaymentRow): PaymentCursor {
	return {
		entryDate: row.entryDate,
		journalId: row.journalId,
	}
}

async function processPaymentPages<T extends WalletPaymentRow>(
	ctx: WorkflowContext,
	findPage: (cursor?: PaymentCursor) => Promise<T[]>,
	paidByType: WalletPaymentInput['paidByType']
): Promise<{ newPaymentsRecorded: number; pageCount: number }> {
	let cursor: PaymentCursor | undefined
	let newPaymentsRecorded = 0
	let pageCount = 0

	while (true) {
		const paymentTransactions = await findPage(cursor)
		if (paymentTransactions.length === 0) {
			break
		}

		const payments = validatePaymentTransactions(ctx, paymentTransactions, paidByType)
		if (payments.length > 0) {
			newPaymentsRecorded += await ctx.billService.recordWalletPayments(ctx.billId, payments)
		}
		pageCount += 1
		cursor = getPaymentCursor(paymentTransactions[paymentTransactions.length - 1])
	}

	return { newPaymentsRecorded, pageCount }
}

export async function findPaymentsForBill(
	ctx: WorkflowContext,
	billData: BillPaymentCheckData
): Promise<{ newPaymentsRecorded: number }> {
	const logger = getWorkflowLogger(ctx, 'check-character-payment-status')
	const searchEnd = new Date()

	logger.info('[Workflow] Checking payment status for bill', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		payeeId: billData.payeeId,
		payeeType: billData.payeeType,
	})

	const payeeType = billData.payeeType

	if (!payeeType) {
		logger.warn('[Workflow] Skipping payment transaction lookup because payee type is missing', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			payeeId: billData.payeeId,
		})
		return { newPaymentsRecorded: 0 }
	}

	if (payeeType === 'corporation') {
		const result = await processPaymentPages(
			ctx,
			(cursor) => findPaymentTransactionsForCorporationFromDb(ctx, billData, searchEnd, cursor),
			'corporation'
		)
		if (result.pageCount === 0) {
			logger.info('[Workflow] No payment transactions found for corporation in persisted data', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				corporationId: billData.payeeId,
				paymentToken: billData.paymentToken,
				fromDate: billData.paymentStartAt,
			})
		}
		logger.info('[Workflow] Processed corporation payment transactions from persisted data', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			corporationId: billData.payeeId,
			pageCount: result.pageCount,
			newPaymentsRecorded: result.newPaymentsRecorded,
		})
		return { newPaymentsRecorded: result.newPaymentsRecorded }
	}

	if (payeeType === 'character') {
		const result = await processPaymentPages(
			ctx,
			(cursor) => findPaymentTransactionsForCharacterFromDb(ctx, billData, searchEnd, cursor),
			billData.payerType ?? 'character'
		)
		if (result.pageCount === 0) {
			logger.info('[Workflow] No payment transactions found for character in persisted data', {
				billId: ctx.billId,
				workflowInstanceId: ctx.workflowInstanceId,
				characterId: billData.payeeId,
				paymentToken: billData.paymentToken,
				fromDate: billData.paymentStartAt,
			})
		}
		logger.info('[Workflow] Processed character payment transactions from persisted data', {
			billId: ctx.billId,
			workflowInstanceId: ctx.workflowInstanceId,
			characterId: billData.payeeId,
			pageCount: result.pageCount,
			newPaymentsRecorded: result.newPaymentsRecorded,
		})
		return { newPaymentsRecorded: result.newPaymentsRecorded }
	}

	logger.info('[Workflow] Skipping payment transaction lookup for unsupported payee type', {
		billId: ctx.billId,
		workflowInstanceId: ctx.workflowInstanceId,
		payeeType,
	})
	return { newPaymentsRecorded: 0 }
}
