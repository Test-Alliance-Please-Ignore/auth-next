import { describe, expect, it } from 'vitest'

import { planProjectionRefreshFromWalletSync } from '../projection-refresh-plan'

import type {
	TaxLedgerIngestionHealth,
	TriggerTaxProjectionRefreshInput,
} from '@repo/corporation-tax'

const OVERLAP_MS = 48 * 60 * 60 * 1000

function createHealth(
	checkpoints: TaxLedgerIngestionHealth['checkpoints']
): TaxLedgerIngestionHealth {
	return {
		ready: true,
		lastEntryUpdatedAt: null,
		checkpoints,
		message: 'ok',
	}
}

function baseInput(
	overrides: Partial<TriggerTaxProjectionRefreshInput> = {}
): TriggerTaxProjectionRefreshInput {
	return {
		corporationId: '98000001',
		upstreamRunId: 'wf-1',
		triggeredAt: new Date('2026-03-20T00:00:00.000Z'),
		walletJournal: null,
		walletTransactions: null,
		includeCharacterWallets: true,
		...overrides,
	}
}

describe('planProjectionRefreshFromWalletSync', () => {
	it('returns no_sources when both wallet source payloads are absent', () => {
		const result = planProjectionRefreshFromWalletSync(baseInput(), createHealth([]), OVERLAP_MS)
		expect(result).toEqual({
			shouldTrigger: false,
			reason: 'no_sources',
		})
	})

	it('returns up_to_date when checkpoint is current for present source payloads', () => {
		const result = planProjectionRefreshFromWalletSync(
			baseInput({
				walletJournal: {
					fetchedCount: 2,
					maxId: '500',
					maxDate: new Date('2026-03-20T00:00:00.000Z'),
				},
			}),
			createHealth([
				{
					id: 'cp-j',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_journal',
					cursor: '600',
					lastSeenAt: new Date('2026-03-20T00:01:00.000Z'),
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-03-19T00:00:00.000Z'),
					updatedAt: new Date('2026-03-20T00:01:00.000Z'),
				},
			]),
			OVERLAP_MS
		)
		expect(result).toEqual({
			shouldTrigger: false,
			reason: 'up_to_date',
		})
	})

	it('returns ingest plan with overlap-window fromDate when checkpoint is stale', () => {
		const lastSeenAt = new Date('2026-03-20T12:00:00.000Z')
		const result = planProjectionRefreshFromWalletSync(
			baseInput({
				walletJournal: {
					fetchedCount: 3,
					maxId: '900',
					maxDate: new Date('2026-03-20T13:00:00.000Z'),
				},
			}),
			createHealth([
				{
					id: 'cp-j',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_journal',
					cursor: '800',
					lastSeenAt,
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-03-19T00:00:00.000Z'),
					updatedAt: new Date('2026-03-20T00:00:00.000Z'),
				},
			]),
			OVERLAP_MS
		)
		expect(result.shouldTrigger).toBe(true)
		if (result.shouldTrigger) {
			expect(result.ingestInput.includeJournal).toBe(true)
			expect(result.ingestInput.includeTransactions).toBe(false)
			expect(result.ingestInput.includeCharacterWallets).toBe(false)
			expect(result.ingestInput.fromDate?.toISOString()).toBe(
				new Date(lastSeenAt.getTime() - OVERLAP_MS).toISOString()
			)
		}
	})

	it('uses earliest overlap date when multiple wallet sources are stale', () => {
		const journalSeenAt = new Date('2026-03-20T12:00:00.000Z')
		const txSeenAt = new Date('2026-03-19T12:00:00.000Z')
		const result = planProjectionRefreshFromWalletSync(
			baseInput({
				walletJournal: {
					fetchedCount: 3,
					maxId: '900',
					maxDate: new Date('2026-03-20T13:00:00.000Z'),
				},
				walletTransactions: {
					fetchedCount: 4,
					maxId: '1200',
					maxDate: new Date('2026-03-20T14:00:00.000Z'),
				},
			}),
			createHealth([
				{
					id: 'cp-j',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_journal',
					cursor: '800',
					lastSeenAt: journalSeenAt,
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-03-19T00:00:00.000Z'),
					updatedAt: new Date('2026-03-20T00:00:00.000Z'),
				},
				{
					id: 'cp-t',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_transaction',
					cursor: '1100',
					lastSeenAt: txSeenAt,
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-03-19T00:00:00.000Z'),
					updatedAt: new Date('2026-03-20T00:00:00.000Z'),
				},
			]),
			OVERLAP_MS
		)
		expect(result.shouldTrigger).toBe(true)
		if (result.shouldTrigger) {
			expect(result.ingestInput.fromDate?.toISOString()).toBe(
				new Date(txSeenAt.getTime() - OVERLAP_MS).toISOString()
			)
			expect(result.ingestInput.includeJournal).toBe(true)
			expect(result.ingestInput.includeTransactions).toBe(true)
		}
	})

	it('allows checkpoint overlap lookback to reach into previous month at boundary', () => {
		const lastSeenAt = new Date('2026-03-01T06:00:00.000Z')
		const result = planProjectionRefreshFromWalletSync(
			baseInput({
				triggeredAt: new Date('2026-03-20T00:00:00.000Z'),
				walletJournal: {
					fetchedCount: 3,
					maxId: '900',
					maxDate: new Date('2026-03-20T13:00:00.000Z'),
				},
			}),
			createHealth([
				{
					id: 'cp-j',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_journal',
					cursor: '800',
					lastSeenAt,
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-02-28T00:00:00.000Z'),
					updatedAt: new Date('2026-03-01T06:00:00.000Z'),
				},
			]),
			OVERLAP_MS
		)
		expect(result.shouldTrigger).toBe(true)
		if (result.shouldTrigger) {
			expect(result.ingestInput.fromDate?.toISOString()).toBe(
				new Date(lastSeenAt.getTime() - OVERLAP_MS).toISOString()
			)
		}
	})

	it('defaults fromDate to start of current month when stale source has no checkpoint timestamp', () => {
		const result = planProjectionRefreshFromWalletSync(
			baseInput({
				triggeredAt: new Date('2026-03-20T00:00:00.000Z'),
				walletJournal: {
					fetchedCount: 3,
					maxId: '900',
					maxDate: new Date('2026-03-20T13:00:00.000Z'),
				},
			}),
			createHealth([
				{
					id: 'cp-j',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_journal',
					cursor: null,
					lastSeenAt: null,
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-02-28T00:00:00.000Z'),
					updatedAt: new Date('2026-03-01T00:00:00.000Z'),
				},
			]),
			OVERLAP_MS
		)
		expect(result.shouldTrigger).toBe(true)
		if (result.shouldTrigger) {
			expect(result.ingestInput.fromDate?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
		}
	})

	it('clamps to current month start when stale checkpoint is older than boundary allowance', () => {
		const lastSeenAt = new Date('2026-02-27T23:00:00.000Z')
		const result = planProjectionRefreshFromWalletSync(
			baseInput({
				triggeredAt: new Date('2026-03-20T00:00:00.000Z'),
				walletJournal: {
					fetchedCount: 3,
					maxId: '900',
					maxDate: new Date('2026-03-20T13:00:00.000Z'),
				},
			}),
			createHealth([
				{
					id: 'cp-j',
					corporationId: '98000001',
					sourceType: 'corporation_wallet_journal',
					cursor: '800',
					lastSeenAt,
					lastSuccessfulSyncAt: null,
					lastError: null,
					createdAt: new Date('2026-02-27T23:00:00.000Z'),
					updatedAt: new Date('2026-02-27T23:00:00.000Z'),
				},
			]),
			OVERLAP_MS
		)
		expect(result.shouldTrigger).toBe(true)
		if (result.shouldTrigger) {
			expect(result.ingestInput.fromDate?.toISOString()).toBe('2026-03-01T00:00:00.000Z')
		}
	})
})
