import { WorkflowEntrypoint } from 'cloudflare:workers'
import { eq, sql } from 'drizzle-orm'

import { getStub } from '@repo/do-utils'
import { formatISK } from '@repo/worker-utils'

import { createDb } from '../db'
import { billNotificationEvents, bills } from '../db/schema'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Discord, MessageContent } from '@repo/discord'
import type { EsiTypeResolver } from '@repo/esi'
import type { Env } from '../context'

export interface BillDiscordNotifyWorkflowParams {
	notificationEventId: string
}

function formatDiscordLongTimestamp(date: Date): string {
	return `<t:${Math.floor(date.getTime() / 1000)}:F>`
}

const COLORS = {
	BLUE: 0x3b82f6,
	YELLOW: 0xf59e0b,
	RED: 0xef4444,
	GREEN: 0x10b981,
}

function toTitleAndColor(eventType: 'issued' | 'due_24h' | 'overdue' | 'paid'): {
	title: string
	color: number
} {
	if (eventType === 'issued') return { title: 'Bill Issued', color: COLORS.BLUE }
	if (eventType === 'due_24h') return { title: 'Bill Due Soon (24h)', color: COLORS.YELLOW }
	if (eventType === 'overdue') return { title: 'Bill Overdue', color: COLORS.RED }
	return { title: 'Bill Paid', color: COLORS.GREEN }
}

function toAlertText(eventType: 'issued' | 'due_24h' | 'overdue' | 'paid'): string {
	if (eventType === 'issued') return 'A bill was issued to you.'
	if (eventType === 'due_24h') return 'A bill assigned to you is due within 24 hours.'
	if (eventType === 'overdue') return 'A bill assigned to you is now overdue.'
	return 'A bill assigned to you was marked as paid.'
}

function buildMessage(input: {
	billId: string
	title: string
	amount: string
	payeeName: string
	dueDate: Date
	eventType: 'issued' | 'due_24h' | 'overdue' | 'paid'
}): MessageContent {
	const { title, color } = toTitleAndColor(input.eventType)
	const alertText = toAlertText(input.eventType)
	const dueLong = formatDiscordLongTimestamp(input.dueDate)
	const amount = `**${formatISK(input.amount, { showDecimals: false })}**`
	return {
		content: '',
		allowEveryone: false,
		embeds: [
			{
				title,
				color,
				description: `${alertText}\n[View Bill](https://pleaseignore.app/my-bills/${input.billId})`,
				fields: [
					{ name: 'Bill', value: input.title, inline: true },
					{ name: 'Amount', value: amount, inline: true },
					{ name: 'Payee', value: input.payeeName, inline: true },
					{ name: 'Due', value: dueLong, inline: false },
				],
				footer: { text: `Bill ID: ${input.billId}` },
				timestamp: new Date().toISOString(),
			},
		],
	}
}

function shouldMarkSkipped(errorMessage: string | null | undefined): boolean {
	if (!errorMessage) return false
	const normalized = errorMessage.toLowerCase()
	return (
		normalized.includes('not linked') ||
		normalized.includes('missing permissions to send dm') ||
		normalized.includes('dm channel not found')
	)
}

function isNotificationStillEligible(input: {
	eventType: 'issued' | 'due_24h' | 'overdue' | 'paid'
	billStatus: string
	paidAt: Date | null
}): boolean {
	if (input.eventType === 'issued') return input.billStatus === 'issued'
	if (input.eventType === 'due_24h') return input.billStatus === 'issued' && !input.paidAt
	if (input.eventType === 'overdue') return input.billStatus === 'overdue' && !input.paidAt
	return input.billStatus === 'paid'
}

export class BillDiscordNotifyWorkflow extends WorkflowEntrypoint<
	Env,
	BillDiscordNotifyWorkflowParams
> {
	async run(event: WorkflowEvent<BillDiscordNotifyWorkflowParams>, step: WorkflowStep) {
		const notificationEventId = event.payload.notificationEventId
		const workflowInstanceId = event.instanceId

		if (!notificationEventId) {
			throw new Error('Missing notificationEventId in workflow payload')
		}

		const claimResult = await step.do('claim-notification-event', async () => {
			const db = createDb(this.env.DATABASE_URL)
			const now = new Date()
			const claimed = await db.execute(sql`
				update bill_notification_events
				set
					workflow_instance_id = ${workflowInstanceId},
					attempt_count = attempt_count + 1,
					updated_at = ${now}
				where
					id = ${notificationEventId}::uuid
					and status in ('pending', 'failed')
					and first_eligible_at <= ${now}
					and (workflow_instance_id is null or workflow_instance_id = ${workflowInstanceId})
				returning id, status, attempt_count
			`)

			if (claimed.rows.length === 0) {
				return { claimed: false as const }
			}
			const row = claimed.rows[0] as { attempt_count: number }
			return { claimed: true as const, attemptCount: Number(row.attempt_count) }
		})

		if (!claimResult.claimed) {
			return {
				success: true,
				skipped: true,
				reason: 'not-claimable',
				notificationEventId,
			}
		}

		const deliveryResult = await step.do(
			'deliver-bill-notification',
			{
				retries: {
					limit: 2,
					delay: 1000,
					backoff: 'exponential',
				},
				timeout: '30 seconds',
			},
			async () => {
				const db = createDb(this.env.DATABASE_URL)
				const eventRow = await db.query.billNotificationEvents.findFirst({
					where: eq(billNotificationEvents.id, notificationEventId),
				})
				if (!eventRow) {
					return { success: false as const, skipped: true as const, error: 'Event not found' }
				}
				const bill = await db.query.bills.findFirst({
					where: eq(bills.id, eventRow.billId),
				})
				if (!bill) {
					return { success: false as const, skipped: true as const, error: 'Bill not found' }
				}
				if (
					!isNotificationStillEligible({
						eventType: eventRow.eventType,
						billStatus: bill.status,
						paidAt: bill.paidAt,
					})
				) {
					return {
						success: false as const,
						skipped: true as const,
						error: `Bill no longer eligible for ${eventRow.eventType} notification`,
					}
				}

				const payeeName =
					bill.payeeId && bill.payeeId.trim().length > 0
						? ((
								await getStub<EsiTypeResolver>(this.env.ESI_TYPE_RESOLVER, 'global').resolveIds([
									bill.payeeId,
								])
							)[bill.payeeId] ?? bill.payeeId)
						: 'Unknown'

				const message = buildMessage({
					billId: bill.id,
					title: bill.title,
					amount: bill.amount,
					payeeName,
					dueDate: bill.dueDate,
					eventType: eventRow.eventType,
				})

				const discord = getStub<Discord>(this.env.DISCORD, 'default')
				const result = await discord.sendDirectMessage(eventRow.recipientUserId, message)
				if (!result.success) {
					return {
						success: false as const,
						skipped: shouldMarkSkipped(result.error),
						error: result.error ?? 'Discord direct message failed',
					}
				}

				return { success: true as const, skipped: false as const, messageId: result.messageId }
			}
		)

		await step.do('finalize-bill-notification', async () => {
			const db = createDb(this.env.DATABASE_URL)
			const now = new Date()
			if (deliveryResult.success) {
				await db
					.update(billNotificationEvents)
					.set({
						status: 'sent',
						sentAt: now,
						lastError: null,
						updatedAt: now,
						workflowInstanceId,
					})
					.where(eq(billNotificationEvents.id, notificationEventId))
				return
			}

			if (deliveryResult.skipped) {
				await db
					.update(billNotificationEvents)
					.set({
						status: 'skipped',
						lastError: deliveryResult.error ?? null,
						updatedAt: now,
						workflowInstanceId,
					})
					.where(eq(billNotificationEvents.id, notificationEventId))
				return
			}

			const backoffMinutes = Math.min(Math.pow(2, claimResult.attemptCount), 360)
			const nextEligible = new Date(now.getTime() + backoffMinutes * 60 * 1000)
			await db
				.update(billNotificationEvents)
				.set({
					status: 'failed',
					lastError: deliveryResult.error ?? 'Unknown delivery failure',
					firstEligibleAt: nextEligible,
					updatedAt: now,
					workflowInstanceId,
				})
				.where(eq(billNotificationEvents.id, notificationEventId))
		})

		return {
			success: deliveryResult.success,
			notificationEventId,
		}
	}
}

export default BillDiscordNotifyWorkflow
