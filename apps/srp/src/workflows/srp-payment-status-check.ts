import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers'

import { sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import {
	buildKillmailReasonNeedle,
	parseAmountToBigInt,
} from './srp-payment-status-check-utils'

import type { EsiTypeResolver } from '@repo/esi'
import type { Srp } from '@repo/srp'
import type { Env } from '../context'

export interface SrpPaymentStatusCheckWorkflowParams {
	requestId: string
}

type WalletJournalMatchRow = {
	journalId: string
	amount: string
	reason: string | null
	firstPartyId: string | null
	secondPartyId: string | null
	entryDate: Date
}

type GroupOwnerRow = {
	groupId: string
	groupName: string
	ownerUserId: string
}

type ExistingMismatchHistoryRow = {
	id: string
}

type ExistingPaymentAlertRow = {
	id: string
}

type DiscordDirectMessenger = {
	sendDirectMessage(
		coreUserId: string,
		message: { content: string; allowEveryone?: boolean }
	): Promise<{ success: boolean; error?: string }>
}

const SYSTEM_ACTOR_USER_ID = '00000000-0000-0000-0000-000000000000'
const SYSTEM_ACTOR_CHARACTER_NAME = 'SRP Payment Monitor'
const PAYMENT_MISMATCH_HISTORY_ACTION = 'payment_amount_mismatch_detected'
const PAYMENT_MISSING_HISTORY_ACTION = 'payment_missing_detected'
const MS_PER_DAY = 86_400_000

function formatISK(value: string | number, options?: { showDecimals?: boolean }): string {
	const num = typeof value === 'string' ? Number.parseFloat(value) : value
	const showDecimals = options?.showDecimals ?? true
	const fractionDigits = showDecimals ? 2 : 0

	if (!Number.isFinite(num)) {
		return `${(0).toFixed(fractionDigits)} ISK`
	}

	return (
		new Intl.NumberFormat('en-US', {
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		}).format(num) + ' ISK'
	)
}

function buildMismatchDiscordAlertContent(input: {
	requestId: string
	requestCharacterId: string
	requestCharacterName?: string
	expectedAmount: string
	observedAmount: string
	journalId: string
	payerId: string | null
	payerName: string | null
	payeeId: string | null
	payeeName: string | null
	isRecipientMismatch: boolean
}) {
	const requestUrl = `https://pleaseignore.app/srp/request/${input.requestId}`
	const expectedRecipientLabel = input.requestCharacterName
		? `${input.requestCharacterName} (\`${input.requestCharacterId}\`)`
		: `\`${input.requestCharacterId}\``
	const actualRecipientLabel = input.payeeId
		? `${input.payeeName ?? 'Unknown'} (\`${input.payeeId}\`)`
		: 'Unknown'
	return [
		`SRP payment value mismatch detected.`,
		`Request: \`${input.requestId}\``,
		`Expected payout: **${formatISK(input.expectedAmount, { showDecimals: false })}**`,
		`Actual payment: **${formatISK(input.observedAmount, { showDecimals: false })}**`,
		`Payer: ${input.payerId ? `${input.payerName ?? 'Unknown'} (\`${input.payerId}\`)` : 'Unknown'}`,
		`Payee: ${actualRecipientLabel}`,
		...(input.isRecipientMismatch
			? [
					`Expected recipient: ${expectedRecipientLabel}`,
					`Actual recipient: ${actualRecipientLabel}`,
				]
			: []),
		`Journal ID: \`${input.journalId}\``,
		`Request details: <${requestUrl}>`,
	].join('\n')
}

function absBigInt(value: bigint): bigint {
	return value < 0n ? -value : value
}

export class SrpPaymentStatusCheckWorkflow extends WorkflowEntrypoint<
	Env,
	SrpPaymentStatusCheckWorkflowParams
> {
	async run(event: WorkflowEvent<SrpPaymentStatusCheckWorkflowParams>, step: WorkflowStep) {
		const { requestId } = event.payload
		const workflowInstanceId = event.instanceId

		if (!requestId) {
			throw new Error('Missing requestId in workflow payload')
		}

		const srpStub = getStub<Srp>(this.env.SRP, 'default')
		const request = await srpStub.getRequest(requestId, SYSTEM_ACTOR_USER_ID)
		if (!request) {
			console.info('[SRP Payment Workflow] Request not found', { requestId, workflowInstanceId })
			return { success: true, skipped: 'request_not_found' as const }
		}
		if (request.requestStatus !== 'payment_pending') {
			console.info('[SRP Payment Workflow] Request not in payment_pending state', {
				requestId,
				workflowInstanceId,
				status: request.requestStatus,
			})
			return { success: true, skipped: 'not_payment_pending' as const }
		}
		if (!request.approvedAmount || parseAmountToBigInt(request.approvedAmount) === null) {
			console.warn('[SRP Payment Workflow] Request missing approved amount', {
				requestId,
				workflowInstanceId,
				approvedAmount: request.approvedAmount,
			})
			return { success: true, skipped: 'invalid_approved_amount' as const }
		}

		const config = await srpStub.getConfig()
		const processorCorporationId = config?.paymentProcessorCorporationId?.trim() ?? ''
		if (!processorCorporationId) {
			console.info('[SRP Payment Workflow] Payment processor corporation is not configured', {
				requestId,
				workflowInstanceId,
			})
			return { success: true, skipped: 'processor_not_configured' as const }
		}

		const approvedAmount = parseAmountToBigInt(request.approvedAmount)
		const reasonNeedle = buildKillmailReasonNeedle(request.id)
		const db = createDb(this.env.DATABASE_URL)

		const walletMatches = await step.do(
			'find-wallet-journal-matches',
			{
				retries: { limit: 3, delay: 1000, backoff: 'exponential' },
				timeout: '30 seconds',
			},
			async () => {
				const paymentDate = request.paymentDate ? new Date(request.paymentDate) : null
				const paymentDateMs = paymentDate?.getTime()
				const fallbackFromDate =
					typeof paymentDateMs === 'number' && Number.isFinite(paymentDateMs)
						? new Date(paymentDateMs - MS_PER_DAY)
						: new Date(request.createdAt)
				const fromDate = fallbackFromDate
				const result = await db.execute<WalletJournalMatchRow>(
					sql`select
						journal_id::text as "journalId",
						amount as "amount",
						reason as "reason",
						first_party_id as "firstPartyId",
						second_party_id as "secondPartyId",
						date as "entryDate"
					from corporation_wallet_journal
					where corporation_id = ${processorCorporationId}
						and date >= ${fromDate}
						and amount::numeric <> 0
						and ref_type = 'corporation_account_withdrawal'
						and reason is not null
						and reason ilike ${`%${reasonNeedle}%`}
					order by date desc
					limit 250`
				)
				return result.rows ?? []
			}
		)

		const rowsWithAmounts = walletMatches
			.map((entry) => ({
				entry,
				parsedAmount: parseAmountToBigInt(entry.amount),
			}))
			.filter((row): row is { entry: WalletJournalMatchRow; parsedAmount: bigint } => row.parsedAmount !== null)

		const matchingRecipientRows = rowsWithAmounts.filter(
			(row) => row.entry.secondPartyId === request.characterId
		)

		const matchedEntry = matchingRecipientRows.find(
			(row) => approvedAmount !== null && absBigInt(row.parsedAmount) === absBigInt(approvedAmount)
		)?.entry

		const recipientMismatchEntry = rowsWithAmounts.find(
			(row) =>
				row.entry.secondPartyId !== request.characterId &&
				approvedAmount !== null &&
				absBigInt(row.parsedAmount) === absBigInt(approvedAmount)
		)?.entry

		const amountMismatchEntry = matchingRecipientRows.find(
			(row) => approvedAmount !== null && absBigInt(row.parsedAmount) !== absBigInt(approvedAmount)
		)?.entry

		const anomalyEntry = amountMismatchEntry ?? recipientMismatchEntry

		if (!matchedEntry && anomalyEntry) {
			const mismatchReason = anomalyEntry.reason ?? reasonNeedle
			const srpGroupId = config?.srpGroupId?.trim() ?? ''
			const isRecipientMismatch = Boolean(recipientMismatchEntry)
			const resolvedIds = [
				anomalyEntry.firstPartyId,
				anomalyEntry.secondPartyId,
				request.characterId,
			].filter((id): id is string => Boolean(id))
			const uniqueResolvedIds = [...new Set(resolvedIds)]
			let resolvedNames: Record<string, string> = {}
			if (uniqueResolvedIds.length > 0) {
				const resolver = getStub<EsiTypeResolver>(this.env.ESI_TYPE_RESOLVER, 'global')
				resolvedNames = await resolver.resolveIds(uniqueResolvedIds).catch(() => ({}))
			}

			const [existingAlert] = (
				await db.execute<ExistingPaymentAlertRow>(
					sql`select id::text as "id"
						from srp_payment_alerts
						where request_id = ${request.id}
							and journal_id = ${anomalyEntry.journalId}
							and observed_amount = ${anomalyEntry.amount}
						limit 1`
				)
			).rows

			let paymentAlertId: string
			if (existingAlert) {
				await db.execute(
					sql`update srp_payment_alerts
						set
							kind = 'payment_mismatch',
							expected_amount = ${request.approvedAmount ?? '0'},
							observed_amount = ${anomalyEntry.amount},
							expected_recipient_character_id = ${request.characterId},
							expected_recipient_character_name = ${request.characterName},
							actual_recipient_character_id = ${anomalyEntry.secondPartyId},
							actual_recipient_character_name = ${anomalyEntry.secondPartyId ? (resolvedNames[anomalyEntry.secondPartyId] ?? null) : null},
							actual_payer_id = ${anomalyEntry.firstPartyId},
							actual_payer_name = ${anomalyEntry.firstPartyId ? (resolvedNames[anomalyEntry.firstPartyId] ?? null) : null},
							reason = ${mismatchReason},
							payment_processor_corporation_id = ${processorCorporationId},
							metadata = ${JSON.stringify({
								isRecipientMismatch,
								expectedRecipientCharacterId: request.characterId,
								actualRecipientCharacterId: anomalyEntry.secondPartyId ?? null,
							})}::jsonb,
							last_seen_at = now()
						where id = ${existingAlert.id}::uuid`
				)
				paymentAlertId = existingAlert.id
			} else {
				const [insertedAlert] = (
					await db.execute<ExistingPaymentAlertRow>(
						sql`insert into srp_payment_alerts (
								request_id,
								kind,
								state,
								journal_id,
								expected_amount,
								observed_amount,
								expected_recipient_character_id,
								expected_recipient_character_name,
								actual_recipient_character_id,
								actual_recipient_character_name,
								actual_payer_id,
								actual_payer_name,
								reason,
								payment_processor_corporation_id,
								metadata
							) values (
								${request.id},
								'payment_mismatch',
								'open',
								${anomalyEntry.journalId},
								${request.approvedAmount ?? '0'},
								${anomalyEntry.amount},
								${request.characterId},
								${request.characterName},
								${anomalyEntry.secondPartyId},
								${anomalyEntry.secondPartyId ? (resolvedNames[anomalyEntry.secondPartyId] ?? null) : null},
								${anomalyEntry.firstPartyId},
								${anomalyEntry.firstPartyId ? (resolvedNames[anomalyEntry.firstPartyId] ?? null) : null},
								${mismatchReason},
								${processorCorporationId},
								${JSON.stringify({
									isRecipientMismatch,
									expectedRecipientCharacterId: request.characterId,
									actualRecipientCharacterId: anomalyEntry.secondPartyId ?? null,
								})}::jsonb
							)
							returning id::text as "id"`
					)
				).rows
				if (!insertedAlert) throw new Error('Failed to persist SRP payment mismatch alert')
				paymentAlertId = insertedAlert.id
			}

			const [existingEvent] = (
				await db.execute<ExistingMismatchHistoryRow>(
					sql`select id::text as "id"
						from srp_request_history
						where request_id = ${request.id}
							and action = ${PAYMENT_MISMATCH_HISTORY_ACTION}
							and metadata->>'journalId' = ${anomalyEntry.journalId}
							and metadata->>'observedAmount' = ${anomalyEntry.amount}
						limit 1`
				)
			).rows

			let discordAlertSent = false
			let discordAlertError: string | null = null
			let srpGroupOwnerUserId: string | null = null
			let srpGroupName: string | null = null

			if (!existingEvent && srpGroupId) {
				const [groupOwner] = (
					await db.execute<GroupOwnerRow>(
						sql`select
								id::text as "groupId",
								name as "groupName",
								owner_id as "ownerUserId"
							from groups
							where id = ${srpGroupId}::uuid
							limit 1`
					)
				).rows
				if (groupOwner) {
					srpGroupOwnerUserId = groupOwner.ownerUserId
					srpGroupName = groupOwner.groupName
					try {
						const discord = getStub<DiscordDirectMessenger>(this.env.DISCORD, 'default')
						const result = await discord.sendDirectMessage(groupOwner.ownerUserId, {
							content: buildMismatchDiscordAlertContent({
								requestId: request.id,
								requestCharacterId: request.characterId,
								requestCharacterName: request.characterName,
								expectedAmount: request.approvedAmount ?? '0',
								observedAmount: anomalyEntry.amount,
								journalId: anomalyEntry.journalId,
								payerId: anomalyEntry.firstPartyId,
								payerName: anomalyEntry.firstPartyId
									? (resolvedNames[anomalyEntry.firstPartyId] ?? null)
									: null,
								payeeId: anomalyEntry.secondPartyId,
								payeeName: anomalyEntry.secondPartyId
									? (resolvedNames[anomalyEntry.secondPartyId] ?? null)
									: null,
								isRecipientMismatch,
							}),
							allowEveryone: false,
						})
						discordAlertSent = result.success
						discordAlertError = result.success ? null : (result.error ?? 'Failed to send Discord DM')
					} catch (error) {
						discordAlertSent = false
						discordAlertError = error instanceof Error ? error.message : String(error)
					}
				} else {
					discordAlertError = 'Configured SRP group not found'
				}
			} else if (!srpGroupId) {
				discordAlertError = 'No SRP group configured'
			}

			if (!existingEvent) {
				const metadata = {
					journalId: anomalyEntry.journalId,
					reason: mismatchReason,
					expectedAmount: request.approvedAmount ?? '0',
					observedAmount: anomalyEntry.amount,
					expectedRecipientCharacterId: request.characterId,
					expectedRecipientCharacterName: request.characterName,
					actualRecipientCharacterId: anomalyEntry.secondPartyId,
					actualRecipientCharacterName: anomalyEntry.secondPartyId
						? (resolvedNames[anomalyEntry.secondPartyId] ?? null)
						: null,
					actualPayerId: anomalyEntry.firstPartyId,
					actualPayerName: anomalyEntry.firstPartyId
						? (resolvedNames[anomalyEntry.firstPartyId] ?? null)
						: null,
					isRecipientMismatch,
					paymentProcessorCorporationId: processorCorporationId,
					srpGroupId: srpGroupId || null,
					srpGroupName,
					srpGroupOwnerUserId,
					discordAlertSent,
					discordAlertError,
					paymentAlertId,
					detectedAt: new Date().toISOString(),
				}
				await db.execute(
					sql`insert into srp_request_history (
							request_id,
							actor_user_id,
							actor_character_name,
							action,
							visibility,
							metadata
						) values (
							${request.id},
							${SYSTEM_ACTOR_USER_ID}::uuid,
							${SYSTEM_ACTOR_CHARACTER_NAME},
							${PAYMENT_MISMATCH_HISTORY_ACTION},
							'internal',
							${JSON.stringify(metadata)}::jsonb
						)`
				)
			}

			console.warn('[SRP Payment Workflow] Reason matched but amount mismatched', {
				requestId,
				workflowInstanceId,
				processorCorporationId,
				srpGroupId: srpGroupId || null,
				journalId: anomalyEntry.journalId,
				expectedAmount: request.approvedAmount,
				observedAmount: anomalyEntry.amount,
				expectedRecipientCharacterId: request.characterId,
				actualRecipientCharacterId: anomalyEntry.secondPartyId,
				isRecipientMismatch,
				discordAlertSent,
				discordAlertError,
				deduped: Boolean(existingEvent),
			})

			return {
				success: true,
				matched: false,
				mismatchDetected: true,
				journalId: anomalyEntry.journalId,
				discordAlertSent,
				deduped: Boolean(existingEvent),
			}
		}

		if (!matchedEntry) {
			const paymentDate = request.paymentDate ? new Date(request.paymentDate) : null
			const paymentDateMs = paymentDate?.getTime()
			const nowMs = Date.now()
			const isOverdueMissingPayment =
				typeof paymentDateMs === 'number' &&
				Number.isFinite(paymentDateMs) &&
				nowMs - paymentDateMs > MS_PER_DAY

			if (isOverdueMissingPayment) {
				const syntheticJournalId = `missing-payment-${request.id}`
				const [existingMissingAlert] = (
					await db.execute<ExistingPaymentAlertRow>(
						sql`select id::text as "id"
							from srp_payment_alerts
							where request_id = ${request.id}
								and kind = 'payment_missing'
								and journal_id = ${syntheticJournalId}
							limit 1`
					)
				).rows

				let paymentAlertId: string
				if (existingMissingAlert) {
					await db.execute(
						sql`update srp_payment_alerts
							set
								state = 'open',
								expected_amount = ${request.approvedAmount ?? '0'},
								observed_amount = '0',
								expected_recipient_character_id = ${request.characterId},
								expected_recipient_character_name = ${request.characterName},
								actual_recipient_character_id = null,
								actual_recipient_character_name = null,
								actual_payer_id = null,
								actual_payer_name = null,
								reason = ${`No matching wallet transaction found within 24 hours of payment_pending for ${reasonNeedle}`},
								payment_processor_corporation_id = ${processorCorporationId},
								metadata = ${JSON.stringify({
									alertType: 'payment_missing',
									paymentDate: request.paymentDate ?? null,
									expectedReason: reasonNeedle,
									thresholdHours: 24,
									matchedTransactionCount: walletMatches.length,
								})}::jsonb,
								last_seen_at = now()
							where id = ${existingMissingAlert.id}::uuid`
					)
					paymentAlertId = existingMissingAlert.id
				} else {
					const [insertedMissingAlert] = (
						await db.execute<ExistingPaymentAlertRow>(
							sql`insert into srp_payment_alerts (
									request_id,
									kind,
									state,
									journal_id,
									expected_amount,
									observed_amount,
									expected_recipient_character_id,
									expected_recipient_character_name,
									actual_recipient_character_id,
									actual_recipient_character_name,
									actual_payer_id,
									actual_payer_name,
									reason,
									payment_processor_corporation_id,
									metadata
								) values (
									${request.id},
									'payment_missing',
									'open',
									${syntheticJournalId},
									${request.approvedAmount ?? '0'},
									'0',
									${request.characterId},
									${request.characterName},
									null,
									null,
									null,
									null,
									${`No matching wallet transaction found within 24 hours of payment_pending for ${reasonNeedle}`},
									${processorCorporationId},
									${JSON.stringify({
										alertType: 'payment_missing',
										paymentDate: request.paymentDate ?? null,
										expectedReason: reasonNeedle,
										thresholdHours: 24,
										matchedTransactionCount: walletMatches.length,
									})}::jsonb
								)
								returning id::text as "id"`
						)
					).rows
					if (!insertedMissingAlert) throw new Error('Failed to persist SRP missing payment alert')
					paymentAlertId = insertedMissingAlert.id
				}

				const [existingMissingEvent] = (
					await db.execute<ExistingMismatchHistoryRow>(
						sql`select id::text as "id"
							from srp_request_history
							where request_id = ${request.id}
								and action = ${PAYMENT_MISSING_HISTORY_ACTION}
								and metadata->>'paymentAlertId' = ${paymentAlertId}
							limit 1`
					)
				).rows

				if (!existingMissingEvent) {
					await db.execute(
						sql`insert into srp_request_history (
								request_id,
								actor_user_id,
								actor_character_name,
								action,
								visibility,
								metadata
							) values (
								${request.id},
								${SYSTEM_ACTOR_USER_ID}::uuid,
								${SYSTEM_ACTOR_CHARACTER_NAME},
								${PAYMENT_MISSING_HISTORY_ACTION},
								'internal',
								${JSON.stringify({
									paymentAlertId,
									expectedAmount: request.approvedAmount ?? '0',
									expectedRecipientCharacterId: request.characterId,
									expectedRecipientCharacterName: request.characterName,
									expectedReason: reasonNeedle,
									paymentDate: request.paymentDate ?? null,
									thresholdHours: 24,
									matchedTransactionCount: walletMatches.length,
								})}::jsonb
							)`
					)
				}
			}

			console.info('[SRP Payment Workflow] No matching wallet transaction found', {
				requestId,
				workflowInstanceId,
				processorCorporationId,
				lossId: request.id,
				expectedReason: reasonNeedle,
				expectedAmount: request.approvedAmount,
				candidateCount: walletMatches.length,
			})
			return { success: true, matched: false }
		}

		await srpStub.updateReviewState(
			request.id,
			SYSTEM_ACTOR_USER_ID,
			SYSTEM_ACTOR_CHARACTER_NAME,
			'paid',
			`Auto-confirmed by wallet transaction ${matchedEntry.journalId} (${matchedEntry.reason ?? reasonNeedle})`
		)

		console.info('[SRP Payment Workflow] Marked request as paid', {
			requestId,
			workflowInstanceId,
			processorCorporationId,
			journalId: matchedEntry.journalId,
			amount: matchedEntry.amount,
			reason: matchedEntry.reason,
		})

		return {
			success: true,
			matched: true,
			journalId: matchedEntry.journalId,
		}
	}
}

export default SrpPaymentStatusCheckWorkflow
