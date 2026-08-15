import { filterTaxIncomeRefTypes, isTaxIncomeRefType } from '@repo/corporation-tax'
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { taxLedgerEntries, taxMemberSummaryVersions, taxSyncCheckpoints } from '../db/schema'
import { formatCenti, parseDecimalToCenti } from './tax-money'

import type {
	IngestTaxLedgerWindowInput,
	ListTaxLedgerPartiesFilters,
	TaxLedgerDirection,
	TaxLedgerEntry,
	TaxLedgerIngestionHealth,
	TaxLedgerIngestionResult,
	TaxLedgerParty,
	TaxLedgerRetentionResult,
	TaxLedgerSourceType,
	TaxLedgerWindowFilters,
	TaxPagedResult,
	TaxSyncCheckpoint,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { CorporationTaxDb } from '../db'

type CharacterWalletJournalRow = {
	journalId: string
	date: Date
	refType: string
	amount: string
	balance: string
	description: string
	firstPartyId?: string
	secondPartyId?: string
	reason?: string
	tax?: string
	taxReceiverId?: string
	contextId?: string
	contextIdType?: string
}

type CharacterMarketTransactionRow = {
	transactionId: string
	date: Date
	typeId: string
	quantity: number
	unitPrice: string
	clientId: string
	locationId: string
	isBuy: boolean
	isPersonal: boolean
	journalRefId: string
}

interface EveCharacterWalletReader {
	getWalletJournalWindow(
		characterId: string,
		filters?: {
			refTypes?: string[]
			firstPartyId?: string
			secondPartyId?: string
			fromDate?: Date
			toDate?: Date
			minAmount?: string
			maxAmount?: string
			limit?: number
			offset?: number
		}
	): Promise<CharacterWalletJournalRow[]>
	getMarketTransactionsWindow(
		characterId: string,
		filters?: {
			clientId?: string
			fromDate?: Date
			toDate?: Date
			limit?: number
			offset?: number
		}
	): Promise<CharacterMarketTransactionRow[]>
}

type EssQualitySignals = {
	duplicateRecordCount: number
	duplicateSourceKeys: string[]
	missingRecordCount: number
	missingSourceKeys: string[]
}

export class TaxLedgerService {
	private readonly INGEST_WINDOW_PAGE_SIZE = 1000
	private readonly LEDGER_UPSERT_BATCH_SIZE = 50

	constructor(
		private db: CorporationTaxDb,
		private eveCorporationDataNamespace: DurableObjectNamespace,
		private eveCharacterDataNamespace: DurableObjectNamespace
	) {}

	async ingestCorporationLedgerWindow(
		corporationId: string,
		input: IngestTaxLedgerWindowInput = {}
	): Promise<TaxLedgerIngestionResult> {
		const incomeRefTypesFilter = filterTaxIncomeRefTypes(input.refTypes)
		const includeJournal = input.includeJournal ?? true
		const includeTransactions = input.includeTransactions ?? true
		// Static override: character wallet ingestion is intentionally disabled for now.
		// Re-enable by switching this gate back to request-driven input handling.
		const includeCharacterWallets = false
		const attemptedSources: TaxLedgerSourceType[] = []

		if (includeJournal) {
			attemptedSources.push('corporation_wallet_journal')
		}
		if (includeTransactions) {
			attemptedSources.push('corporation_wallet_transaction')
		}
		if (includeCharacterWallets && includeJournal) {
			attemptedSources.push('character_wallet_journal')
		}
		if (includeCharacterWallets && includeTransactions) {
			attemptedSources.push('character_wallet_transaction')
		}

		const corporationStub = getStub<EveCorporationData>(
			this.eveCorporationDataNamespace,
			corporationId
		)

		try {
			const [journalRows, transactionRows] = await Promise.all([
				includeJournal
					? this.fetchWindowPages(
							{
								limit: input.limit,
								offset: input.offset,
							},
							(page) =>
								corporationStub.getWalletJournalWindow(corporationId, {
									division: input.division,
									refTypes: incomeRefTypesFilter,
									firstPartyId: input.firstPartyId,
									secondPartyId: input.secondPartyId,
									fromDate: input.fromDate,
									toDate: input.toDate,
									minAmount: input.minAmount,
									maxAmount: input.maxAmount,
									limit: page.limit,
									offset: page.offset,
								})
						)
					: Promise.resolve([]),
				includeTransactions
					? this.fetchWindowPages(
							{
								limit: input.limit,
								offset: input.offset,
							},
							(page) =>
								corporationStub.getWalletTransactionsWindow(corporationId, {
									division: input.division,
									fromDate: input.fromDate,
									toDate: input.toDate,
									limit: page.limit,
									offset: page.offset,
								})
						)
					: Promise.resolve([]),
			])

			let characterJournalRows: Array<{
				characterId: string
				row: CharacterWalletJournalRow
			}> = []
			let characterTransactionRows: Array<{
				characterId: string
				row: CharacterMarketTransactionRow
			}> = []
			let characterWalletErrorCount = 0
			let characterWalletErrorMessage: string | null = null
			let characterWalletFetchSucceeded = false

			if (includeCharacterWallets && (includeJournal || includeTransactions)) {
				try {
					const result = await this.fetchCharacterWalletRows(corporationStub, corporationId, {
						includeJournal,
						includeTransactions,
						memberCharacterIds: input.memberCharacterIds,
						maxMemberCharacters: input.maxMemberCharacters,
						refTypes: incomeRefTypesFilter,
						firstPartyId: input.firstPartyId,
						secondPartyId: input.secondPartyId,
						fromDate: input.fromDate,
						toDate: input.toDate,
						minAmount: input.minAmount,
						maxAmount: input.maxAmount,
						limit: input.limit,
						offset: input.offset,
					})
					characterJournalRows = result.journalRows
					characterTransactionRows = result.transactionRows
					characterWalletErrorCount = result.failedCharacters
					characterWalletFetchSucceeded = true
				} catch (error) {
					characterWalletErrorMessage = this.toCheckpointError(error)
				}
			}

			const values: Array<typeof taxLedgerEntries.$inferInsert> = []
			const now = new Date()

			for (const row of journalRows) {
				if (!isTaxIncomeRefType(row.refType)) {
					continue
				}
				const amount = row.amount ?? '0'
				const direction = this.toDirection(amount)
				values.push({
					corporationId,
					sourceType: 'corporation_wallet_journal',
					sourcePrimaryId: row.journalId,
					sourceSecondaryId: String(row.division),
					sourceKey: `${corporationId}:journal:${row.division}:${row.journalId}`,
					division: row.division,
					refType: row.refType,
					amount,
					balance: row.balance,
					direction,
					firstPartyId: row.firstPartyId,
					secondPartyId: row.secondPartyId,
					entryDate: row.date,
				})
			}

			for (const row of transactionRows) {
				const signedTotal = this.toSignedTransactionAmount(row.unitPrice, row.quantity, row.isBuy)
				values.push({
					corporationId,
					sourceType: 'corporation_wallet_transaction',
					sourcePrimaryId: row.transactionId,
					sourceSecondaryId: String(row.division),
					sourceKey: `${corporationId}:transaction:${row.division}:${row.transactionId}`,
					division: row.division,
					refType: 'market_transaction',
					amount: signedTotal,
					balance: null,
					direction: this.toDirection(signedTotal),
					firstPartyId: null,
					secondPartyId: row.clientId,
					entryDate: row.date,
				})
			}

			for (const item of characterJournalRows) {
				if (!isTaxIncomeRefType(item.row.refType)) {
					continue
				}
				const amount = item.row.amount ?? '0'
				const direction = this.toDirection(amount)
				values.push({
					corporationId,
					sourceType: 'character_wallet_journal',
					sourcePrimaryId: item.row.journalId,
					sourceSecondaryId: item.characterId,
					sourceKey: `${corporationId}:character-journal:${item.characterId}:${item.row.journalId}`,
					division: null,
					refType: item.row.refType,
					amount,
					balance: item.row.balance,
					direction,
					firstPartyId: item.row.firstPartyId ?? null,
					secondPartyId: item.row.secondPartyId ?? null,
					entryDate: item.row.date,
				})
			}

			for (const item of characterTransactionRows) {
				const signedTotal = this.toSignedTransactionAmount(
					item.row.unitPrice,
					item.row.quantity,
					item.row.isBuy
				)
				values.push({
					corporationId,
					sourceType: 'character_wallet_transaction',
					sourcePrimaryId: item.row.transactionId,
					sourceSecondaryId: item.characterId,
					sourceKey: `${corporationId}:character-transaction:${item.characterId}:${item.row.transactionId}`,
					division: null,
					refType: 'market_transaction',
					amount: signedTotal,
					balance: null,
					direction: this.toDirection(signedTotal),
					firstPartyId: item.characterId,
					secondPartyId: item.row.clientId,
					entryDate: item.row.date,
				})
			}

			const essQualitySignals = this.summarizeEssQualitySignals(values)
			const unexpectedIncomeRefTypeSignals = this.summarizeUnexpectedPositiveRefTypeSignals(
				corporationId,
				journalRows,
				characterJournalRows
			)
			const unexpectedIncomeEntryCount = unexpectedIncomeRefTypeSignals.reduce(
				(total, signal) => total + signal.entryCount,
				0
			)

			if (values.length > 0) {
				await this.upsertLedgerEntriesInBatches(values, now)
			}

			let checkpointsUpdated = 0
			if (includeJournal) {
				await this.upsertCheckpoint(corporationId, 'corporation_wallet_journal', {
					cursor: this.resolveMaxNumericCursor(journalRows.map((row) => row.journalId)),
					lastSeenAt: this.resolveLatestDate(journalRows.map((row) => row.date)),
					lastSuccessfulSyncAt: now,
					lastError: null,
				})
				checkpointsUpdated += 1
			}

			if (includeTransactions) {
				await this.upsertCheckpoint(corporationId, 'corporation_wallet_transaction', {
					cursor: this.resolveMaxNumericCursor(transactionRows.map((row) => row.transactionId)),
					lastSeenAt: this.resolveLatestDate(transactionRows.map((row) => row.date)),
					lastSuccessfulSyncAt: now,
					lastError: null,
				})
				checkpointsUpdated += 1
			}

			if (includeCharacterWallets && includeJournal) {
				await this.upsertCheckpoint(corporationId, 'character_wallet_journal', {
					cursor: characterWalletFetchSucceeded
						? this.resolveMaxNumericCursor(characterJournalRows.map((row) => row.row.journalId))
						: undefined,
					lastSeenAt: characterWalletFetchSucceeded
						? this.resolveLatestDate(characterJournalRows.map((row) => row.row.date))
						: undefined,
					lastSuccessfulSyncAt: characterWalletFetchSucceeded ? now : undefined,
					lastError: characterWalletFetchSucceeded
						? characterWalletErrorCount > 0
							? `Partial character wallet ingestion failures: ${characterWalletErrorCount}`
							: null
						: characterWalletErrorMessage,
				})
				checkpointsUpdated += 1
			}

			if (includeCharacterWallets && includeTransactions) {
				await this.upsertCheckpoint(corporationId, 'character_wallet_transaction', {
					cursor: characterWalletFetchSucceeded
						? this.resolveMaxNumericCursor(
								characterTransactionRows.map((row) => row.row.transactionId)
							)
						: undefined,
					lastSeenAt: characterWalletFetchSucceeded
						? this.resolveLatestDate(characterTransactionRows.map((row) => row.row.date))
						: undefined,
					lastSuccessfulSyncAt: characterWalletFetchSucceeded ? now : undefined,
					lastError: characterWalletFetchSucceeded
						? characterWalletErrorCount > 0
							? `Partial character wallet ingestion failures: ${characterWalletErrorCount}`
							: null
						: characterWalletErrorMessage,
				})
				checkpointsUpdated += 1
			}

			if (values.length > 0) {
				await this.bumpMemberSummaryProjectionVersion(corporationId, now)
			}

			return {
				corporationId,
				journalProcessed: journalRows.length + characterJournalRows.length,
				transactionProcessed: transactionRows.length + characterTransactionRows.length,
				upsertedCount: values.length,
				checkpointsUpdated,
				essDuplicateRecordCount: essQualitySignals.duplicateRecordCount,
				essDuplicateSourceKeys: essQualitySignals.duplicateSourceKeys,
				essMissingRecordCount: essQualitySignals.missingRecordCount,
				essMissingSourceKeys: essQualitySignals.missingSourceKeys,
				unexpectedIncomeRefTypeCount: unexpectedIncomeRefTypeSignals.length,
				unexpectedIncomeEntryCount,
				unexpectedIncomeRefTypes: unexpectedIncomeRefTypeSignals,
			}
		} catch (error) {
			await Promise.all(
				attemptedSources.map((sourceType) =>
					this.upsertCheckpoint(corporationId, sourceType, {
						lastError: this.toCheckpointError(error),
					})
				)
			)
			throw error
		}
	}

	private async bumpMemberSummaryProjectionVersion(
		corporationId: string,
		now: Date
	): Promise<void> {
		if (!this.supportsMemberSummaryVersioning()) {
			return
		}
		await this.db
			.insert(taxMemberSummaryVersions)
			.values({
				corporationId,
				projectionVersion: 1,
				finalizedVersion: 0,
				projectionUpdatedAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: taxMemberSummaryVersions.corporationId,
				set: {
					projectionVersion: sql`${taxMemberSummaryVersions.projectionVersion} + 1`,
					projectionUpdatedAt: now,
					updatedAt: now,
				},
			})
	}

	private supportsMemberSummaryVersioning(): boolean {
		return Boolean(
			this.db.query &&
				(this.db.query as Record<string, unknown>).taxMemberSummaryVersions &&
				typeof this.db.insert === 'function'
		)
	}

	async listLedgerEntries(
		corporationId: string,
		filters: TaxLedgerWindowFilters = {}
	): Promise<TaxPagedResult<TaxLedgerEntry>> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions = [eq(taxLedgerEntries.corporationId, corporationId)]
		if (filters.division !== undefined) {
			conditions.push(eq(taxLedgerEntries.division, filters.division))
		}
		if (filters.sourceTypes && filters.sourceTypes.length > 0) {
			conditions.push(inArray(taxLedgerEntries.sourceType, filters.sourceTypes))
		}
		if (filters.characterId) {
			const characterCondition = and(
				inArray(taxLedgerEntries.sourceType, [
					'character_wallet_journal',
					'character_wallet_transaction',
				]),
				eq(taxLedgerEntries.sourceSecondaryId, filters.characterId)
			)
			if (characterCondition) {
				conditions.push(characterCondition)
			}
		}
		if (filters.refTypes && filters.refTypes.length > 0) {
			conditions.push(inArray(taxLedgerEntries.refType, filters.refTypes))
		}
		if (filters.firstPartyId) {
			conditions.push(eq(taxLedgerEntries.firstPartyId, filters.firstPartyId))
		}
		if (filters.secondPartyId) {
			conditions.push(eq(taxLedgerEntries.secondPartyId, filters.secondPartyId))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxLedgerEntries.entryDate, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxLedgerEntries.entryDate, filters.toDate))
		}
		const minAmount = Number(filters.minAmount)
		if (Number.isFinite(minAmount)) {
			conditions.push(sql`CAST(${taxLedgerEntries.amount} AS numeric) >= ${minAmount}`)
		}
		const maxAmount = Number(filters.maxAmount)
		if (Number.isFinite(maxAmount)) {
			conditions.push(sql`CAST(${taxLedgerEntries.amount} AS numeric) <= ${maxAmount}`)
		}

		const [{ count: totalRows }] = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(taxLedgerEntries)
			.where(and(...conditions))

		const rows = await this.db.query.taxLedgerEntries.findMany({
			where: and(...conditions),
			orderBy: [
				filters.sortBy === 'amount'
					? filters.sortDir === 'asc'
						? sql`CAST(${taxLedgerEntries.amount} AS numeric) ASC`
						: sql`CAST(${taxLedgerEntries.amount} AS numeric) DESC`
					: filters.sortBy === 'division'
						? filters.sortDir === 'asc'
							? asc(taxLedgerEntries.division)
							: desc(taxLedgerEntries.division)
						: filters.sortBy === 'refType'
							? filters.sortDir === 'asc'
								? asc(taxLedgerEntries.refType)
								: desc(taxLedgerEntries.refType)
							: filters.sortBy === 'sourceType'
								? filters.sortDir === 'asc'
									? asc(taxLedgerEntries.sourceType)
									: desc(taxLedgerEntries.sourceType)
								: filters.sortDir === 'asc'
									? asc(taxLedgerEntries.entryDate)
									: desc(taxLedgerEntries.entryDate),
			],
			limit,
			offset,
		})

		return {
			totalRows: Number(totalRows ?? 0),
			rows: rows.map((row) => ({
				id: row.id,
				corporationId: row.corporationId,
				sourceType: row.sourceType,
				sourcePrimaryId: row.sourcePrimaryId,
				sourceSecondaryId: row.sourceSecondaryId,
				characterId: this.extractCharacterId(row),
				division: row.division,
				refType: row.refType,
				amount: row.amount,
				balance: row.balance,
				direction: row.direction as TaxLedgerDirection,
				firstPartyId: row.firstPartyId,
				secondPartyId: row.secondPartyId,
				entryDate: row.entryDate,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			})),
		}
	}

	async listLedgerParties(
		corporationId: string,
		filters: ListTaxLedgerPartiesFilters = {}
	): Promise<TaxLedgerParty[]> {
		const limit = Math.min(Math.max(filters.limit ?? 500, 1), 2_000)
		const baseConditions = [eq(taxLedgerEntries.corporationId, corporationId)]
		if (filters.fromDate) {
			baseConditions.push(gte(taxLedgerEntries.entryDate, filters.fromDate))
		}
		if (filters.toDate) {
			baseConditions.push(lte(taxLedgerEntries.entryDate, filters.toDate))
		}

		const maxSenderSeenExpr = sql<Date>`max(${taxLedgerEntries.entryDate})`
		const maxRecipientSeenExpr = sql<Date>`max(${taxLedgerEntries.entryDate})`
		const senderRows = await this.db
			.select({
				entityId: taxLedgerEntries.firstPartyId,
				senderCount: sql<number>`count(*)`,
				lastSeenAt: maxSenderSeenExpr,
			})
			.from(taxLedgerEntries)
			.where(and(...baseConditions, isNotNull(taxLedgerEntries.firstPartyId)))
			.groupBy(taxLedgerEntries.firstPartyId)
			.orderBy(desc(maxSenderSeenExpr))
			.limit(limit)

		const recipientRows = await this.db
			.select({
				entityId: taxLedgerEntries.secondPartyId,
				recipientCount: sql<number>`count(*)`,
				lastSeenAt: maxRecipientSeenExpr,
			})
			.from(taxLedgerEntries)
			.where(and(...baseConditions, isNotNull(taxLedgerEntries.secondPartyId)))
			.groupBy(taxLedgerEntries.secondPartyId)
			.orderBy(desc(maxRecipientSeenExpr))
			.limit(limit)

		const merged = new Map<string, TaxLedgerParty>()
		for (const row of senderRows) {
			const entityId = row.entityId
			if (!entityId || !row.lastSeenAt) continue
			const senderCount = Number(row.senderCount ?? 0)
			const current = merged.get(entityId)
			if (!current) {
				merged.set(entityId, {
					entityId,
					senderCount,
					recipientCount: 0,
					lastSeenAt: row.lastSeenAt,
				})
				continue
			}
			current.senderCount += senderCount
			if (row.lastSeenAt > current.lastSeenAt) {
				current.lastSeenAt = row.lastSeenAt
			}
		}
		for (const row of recipientRows) {
			const entityId = row.entityId
			if (!entityId || !row.lastSeenAt) continue
			const recipientCount = Number(row.recipientCount ?? 0)
			const current = merged.get(entityId)
			if (!current) {
				merged.set(entityId, {
					entityId,
					senderCount: 0,
					recipientCount,
					lastSeenAt: row.lastSeenAt,
				})
				continue
			}
			current.recipientCount += recipientCount
			if (row.lastSeenAt > current.lastSeenAt) {
				current.lastSeenAt = row.lastSeenAt
			}
		}

		return Array.from(merged.values())
			.sort((left, right) => {
				const byLastSeen = right.lastSeenAt.getTime() - left.lastSeenAt.getTime()
				if (byLastSeen !== 0) {
					return byLastSeen
				}
				return right.senderCount + right.recipientCount - (left.senderCount + left.recipientCount)
			})
			.slice(0, limit)
	}

	async getIngestionHealth(corporationId: string): Promise<TaxLedgerIngestionHealth> {
		const lastEntry = await this.db.query.taxLedgerEntries.findFirst({
			where: eq(taxLedgerEntries.corporationId, corporationId),
			orderBy: [desc(taxLedgerEntries.updatedAt)],
		})
		const checkpoints = await this.db.query.taxSyncCheckpoints.findMany({
			where: eq(taxSyncCheckpoints.corporationId, corporationId),
			orderBy: [desc(taxSyncCheckpoints.updatedAt)],
			limit: 10,
		})

		return {
			ready: true,
			lastEntryUpdatedAt: lastEntry?.updatedAt ?? null,
			checkpoints: checkpoints.map((checkpoint) => this.toCheckpointDto(checkpoint)),
			message: 'Ledger ingestion service ready',
		}
	}

	async trimLedgerEntries(
		corporationId: string,
		retentionDays = 90
	): Promise<TaxLedgerRetentionResult> {
		const normalizedRetentionDays = Math.min(Math.max(Math.trunc(retentionDays), 1), 3650)
		const cutoffDate = new Date()
		cutoffDate.setUTCDate(cutoffDate.getUTCDate() - normalizedRetentionDays)

		const deleted = await this.db
			.delete(taxLedgerEntries)
			.where(
				and(
					eq(taxLedgerEntries.corporationId, corporationId),
					lt(taxLedgerEntries.entryDate, cutoffDate)
				)
			)
			.returning({ id: taxLedgerEntries.id })

		return {
			corporationId,
			retentionDays: normalizedRetentionDays,
			cutoffDate,
			deletedEntryCount: deleted.length,
		}
	}

	private async fetchCharacterWalletRows(
		corporationStub: EveCorporationData,
		corporationId: string,
		input: {
			includeJournal: boolean
			includeTransactions: boolean
			memberCharacterIds?: string[]
			maxMemberCharacters?: number
			refTypes?: string[]
			firstPartyId?: string
			secondPartyId?: string
			fromDate?: Date
			toDate?: Date
			minAmount?: string
			maxAmount?: string
			limit?: number
			offset?: number
		}
	): Promise<{
		journalRows: Array<{ characterId: string; row: CharacterWalletJournalRow }>
		transactionRows: Array<{ characterId: string; row: CharacterMarketTransactionRow }>
		failedCharacters: number
	}> {
		const memberCharacterIds = await this.resolveTargetMemberCharacterIds(
			corporationStub,
			corporationId,
			input.memberCharacterIds,
			input.maxMemberCharacters
		)

		if (memberCharacterIds.length === 0) {
			return {
				journalRows: [],
				transactionRows: [],
				failedCharacters: 0,
			}
		}

		const rows = await this.mapWithConcurrency(memberCharacterIds, 8, async (characterId) => {
			const characterStub = getStub<EveCharacterWalletReader>(
				this.eveCharacterDataNamespace,
				characterId
			)
			try {
				const [journalRows, transactionRows] = await Promise.all([
					input.includeJournal
						? this.fetchWindowPages(
								{
									limit: input.limit,
									offset: input.offset,
								},
								(page) =>
									characterStub.getWalletJournalWindow(characterId, {
										refTypes: input.refTypes,
										firstPartyId: input.firstPartyId,
										secondPartyId: input.secondPartyId,
										fromDate: input.fromDate,
										toDate: input.toDate,
										minAmount: input.minAmount,
										maxAmount: input.maxAmount,
										limit: page.limit,
										offset: page.offset,
									})
							)
						: Promise.resolve([] as CharacterWalletJournalRow[]),
					input.includeTransactions
						? this.fetchWindowPages(
								{
									limit: input.limit,
									offset: input.offset,
								},
								(page) =>
									characterStub.getMarketTransactionsWindow(characterId, {
										clientId: input.secondPartyId,
										fromDate: input.fromDate,
										toDate: input.toDate,
										limit: page.limit,
										offset: page.offset,
									})
							)
						: Promise.resolve([] as CharacterMarketTransactionRow[]),
				])

				return {
					characterId,
					journalRows,
					transactionRows,
					failed: false,
				}
			} catch {
				return {
					characterId,
					journalRows: [] as CharacterWalletJournalRow[],
					transactionRows: [] as CharacterMarketTransactionRow[],
					failed: true,
				}
			}
		})

		const journalRows: Array<{ characterId: string; row: CharacterWalletJournalRow }> = []
		const transactionRows: Array<{ characterId: string; row: CharacterMarketTransactionRow }> = []
		let failedCharacters = 0

		for (const row of rows) {
			if (row.failed) {
				failedCharacters += 1
				continue
			}
			for (const journalRow of row.journalRows) {
				journalRows.push({
					characterId: row.characterId,
					row: journalRow,
				})
			}
			for (const transactionRow of row.transactionRows) {
				transactionRows.push({
					characterId: row.characterId,
					row: transactionRow,
				})
			}
		}

		return {
			journalRows,
			transactionRows,
			failedCharacters,
		}
	}

	private async resolveTargetMemberCharacterIds(
		corporationStub: EveCorporationData,
		corporationId: string,
		memberCharacterIds?: string[],
		maxMemberCharacters?: number
	): Promise<string[]> {
		// Character wallet ingestion is currently disabled (see static override in ingest path),
		// but keep this cap sane for when we re-enable it.
		// TODO: Replace this static fallback with authoritative corp member counts from public corp data.
		const maxCharacters = Math.min(Math.max(Math.trunc(maxMemberCharacters ?? 5_000), 1), 5_000)
		const providedIds =
			memberCharacterIds
				?.map((value) => value.trim())
				.filter((value) => value.length > 0)
				.slice(0, maxCharacters) ?? []

		if (providedIds.length > 0) {
			return Array.from(new Set(providedIds))
		}

		const members = await corporationStub.getMembers(corporationId)
		return Array.from(new Set(members.map((member) => member.characterId))).slice(0, maxCharacters)
	}

	private async mapWithConcurrency<T, R>(
		items: T[],
		concurrency: number,
		mapper: (item: T) => Promise<R>
	): Promise<R[]> {
		if (items.length === 0) {
			return []
		}
		const effectiveConcurrency = Math.min(Math.max(Math.trunc(concurrency), 1), items.length)
		const results: R[] = []
		let nextIndex = 0

		const workers = Array.from({ length: effectiveConcurrency }, async () => {
			while (nextIndex < items.length) {
				const index = nextIndex
				nextIndex += 1
				results[index] = await mapper(items[index]!)
			}
		})

		await Promise.all(workers)
		return results
	}

	private async fetchWindowPages<TRow>(
		paging: { limit?: number; offset?: number },
		fetchPage: (page: { limit: number; offset: number }) => Promise<TRow[]>
	): Promise<TRow[]> {
		const explicitPaging = typeof paging.limit === 'number' || typeof paging.offset === 'number'
		if (explicitPaging) {
			const limit = Math.min(
				Math.max(Math.trunc(paging.limit ?? this.INGEST_WINDOW_PAGE_SIZE), 1),
				10000
			)
			const offset = Math.max(Math.trunc(paging.offset ?? 0), 0)
			return fetchPage({ limit, offset })
		}

		const pageSize = this.INGEST_WINDOW_PAGE_SIZE
		const rows: TRow[] = []
		let offset = 0
		for (;;) {
			const pageRows = await fetchPage({ limit: pageSize, offset })
			if (pageRows.length === 0) {
				break
			}
			rows.push(...pageRows)
			if (pageRows.length < pageSize) {
				break
			}
			offset += pageSize
		}
		return rows
	}

	private toDirection(amount: string): TaxLedgerDirection {
		const parsed = Number(amount)
		if (!Number.isFinite(parsed) || parsed === 0) {
			return 'neutral'
		}
		return parsed > 0 ? 'inflow' : 'outflow'
	}

	private toSignedTransactionAmount(unitPrice: string, quantity: number, isBuy: boolean): string {
		const unitPriceCenti = parseDecimalToCenti(unitPrice)
		const normalizedQuantity = Number.isFinite(quantity) ? Math.trunc(quantity) : 0
		const quantityInt = normalizedQuantity > 0 ? BigInt(normalizedQuantity) : 0n
		const totalCenti = unitPriceCenti * quantityInt
		const signedCenti = isBuy ? -totalCenti : totalCenti
		return formatCenti(signedCenti)
	}

	private summarizeEssQualitySignals(
		values: Array<typeof taxLedgerEntries.$inferInsert>
	): EssQualitySignals {
		const seenEssSourceKeys = new Set<string>()
		const duplicateEssSourceKeys = new Set<string>()
		let duplicateRecordCount = 0

		for (const row of values) {
			if (row.refType !== 'ess_escrow_transfer') {
				continue
			}

			if (seenEssSourceKeys.has(row.sourceKey)) {
				duplicateRecordCount += 1
				duplicateEssSourceKeys.add(row.sourceKey)
			} else {
				seenEssSourceKeys.add(row.sourceKey)
			}
		}

		return {
			duplicateRecordCount,
			duplicateSourceKeys: Array.from(duplicateEssSourceKeys).slice(0, 25),
			missingRecordCount: 0,
			missingSourceKeys: [],
		}
	}

	private summarizeUnexpectedPositiveRefTypeSignals(
		corporationId: string,
		corporationJournalRows: Array<{
			division: number
			journalId: string
			refType: string
			amount: string | null
			date: Date
		}>,
		characterJournalRows: Array<{ characterId: string; row: CharacterWalletJournalRow }>
	): Array<{
		refType: string
		entryCount: number
		sampleSourceType: TaxLedgerSourceType
		sampleSourceKey: string
		sampleAmount: string
		sampleEntryDate: Date
	}> {
		const byRefType = new Map<
			string,
			{
				refType: string
				entryCount: number
				sampleSourceType: TaxLedgerSourceType
				sampleSourceKey: string
				sampleAmount: string
				sampleEntryDate: Date
			}
		>()

		const record = (
			refType: string,
			amount: string | null,
			sampleSourceType: TaxLedgerSourceType,
			sampleSourceKey: string,
			sampleEntryDate: Date
		) => {
			if (isTaxIncomeRefType(refType) || !this.isPositiveAmount(amount)) {
				return
			}

			const existing = byRefType.get(refType)
			if (existing) {
				existing.entryCount += 1
				return
			}

			byRefType.set(refType, {
				refType,
				entryCount: 1,
				sampleSourceType,
				sampleSourceKey,
				sampleAmount: amount ?? '0',
				sampleEntryDate,
			})
		}

		for (const row of corporationJournalRows) {
			record(
				row.refType,
				row.amount,
				'corporation_wallet_journal',
				`${corporationId}:journal:${row.division}:${row.journalId}`,
				row.date
			)
		}

		for (const item of characterJournalRows) {
			record(
				item.row.refType,
				item.row.amount,
				'character_wallet_journal',
				`${corporationId}:character-journal:${item.characterId}:${item.row.journalId}`,
				item.row.date
			)
		}

		return Array.from(byRefType.values()).sort((a, b) => a.refType.localeCompare(b.refType))
	}

	private isPositiveAmount(amount: string | null | undefined): boolean {
		if (!amount) {
			return false
		}
		const numeric = Number(amount)
		return Number.isFinite(numeric) && numeric > 0
	}

	private async upsertCheckpoint(
		corporationId: string,
		sourceType: TaxLedgerSourceType,
		update: {
			cursor?: string | null
			lastSeenAt?: Date | null
			lastSuccessfulSyncAt?: Date | null
			lastError?: string | null
		}
	): Promise<void> {
		const now = new Date()
		const set: Partial<typeof taxSyncCheckpoints.$inferInsert> = {
			updatedAt: now,
		}
		// Preserve existing cursor when the current source window is empty.
		// We only advance cursor on observed data (non-null values).
		if (update.cursor !== undefined && update.cursor !== null) {
			set.cursor = update.cursor
		}
		// Preserve existing lastSeenAt when the current source window is empty.
		// We only advance lastSeenAt on observed data (non-null values).
		if (update.lastSeenAt !== undefined && update.lastSeenAt !== null) {
			set.lastSeenAt = update.lastSeenAt
		}
		if (update.lastSuccessfulSyncAt !== undefined) {
			set.lastSuccessfulSyncAt = update.lastSuccessfulSyncAt
		}
		if (update.lastError !== undefined) {
			set.lastError = update.lastError
		}

		await this.db
			.insert(taxSyncCheckpoints)
			.values({
				corporationId,
				sourceType,
				cursor: update.cursor ?? null,
				lastSeenAt: update.lastSeenAt ?? null,
				lastSuccessfulSyncAt: update.lastSuccessfulSyncAt ?? null,
				lastError: update.lastError ?? null,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [taxSyncCheckpoints.corporationId, taxSyncCheckpoints.sourceType],
				set,
			})
	}

	private async upsertLedgerEntriesInBatches(
		values: Array<typeof taxLedgerEntries.$inferInsert>,
		updatedAt: Date
	): Promise<void> {
		for (let index = 0; index < values.length; index += this.LEDGER_UPSERT_BATCH_SIZE) {
			const batch = values.slice(index, index + this.LEDGER_UPSERT_BATCH_SIZE)
			await this.db
				.insert(taxLedgerEntries)
				.values(batch)
				.onConflictDoUpdate({
					target: taxLedgerEntries.sourceKey,
					set: {
						refType: sql`excluded.ref_type`,
						amount: sql`excluded.amount`,
						balance: sql`excluded.balance`,
						direction: sql`excluded.direction`,
						firstPartyId: sql`excluded.first_party_id`,
						secondPartyId: sql`excluded.second_party_id`,
						entryDate: sql`excluded.entry_date`,
						updatedAt,
					},
				})
		}
	}

	private resolveLatestDate(dates: Date[]): Date | null {
		if (dates.length === 0) {
			return null
		}
		return dates.reduce((latest, current) => (current > latest ? current : latest))
	}

	private resolveMaxNumericCursor(cursors: string[]): string | null {
		if (cursors.length === 0) {
			return null
		}
		return cursors.reduce((max, current) => {
			const maxNumeric = Number(max)
			const currentNumeric = Number(current)
			if (Number.isFinite(maxNumeric) && Number.isFinite(currentNumeric)) {
				return currentNumeric > maxNumeric ? current : max
			}
			return current > max ? current : max
		})
	}

	private toCheckpointError(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error)
		return message.slice(0, 1000)
	}

	private toCheckpointDto(row: typeof taxSyncCheckpoints.$inferSelect): TaxSyncCheckpoint {
		return {
			id: row.id,
			corporationId: row.corporationId,
			sourceType: row.sourceType as TaxLedgerSourceType,
			cursor: row.cursor,
			lastSeenAt: row.lastSeenAt,
			lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
			lastError: row.lastError,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private extractCharacterId(row: typeof taxLedgerEntries.$inferSelect): string | null {
		if (
			row.sourceType === 'character_wallet_journal' ||
			row.sourceType === 'character_wallet_transaction'
		) {
			return row.sourceSecondaryId ?? null
		}
		return null
	}
}
