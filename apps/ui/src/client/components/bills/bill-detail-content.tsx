import { ArrowLeft, Edit } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { BillFeedback } from '@/components/bills/bill-feedback'
import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
	formatNumber,
	formatDate as localizedDate,
	formatDateTime as localizedDateTime,
	useAppTranslation,
} from '@/i18n'
import { formatEntityType, formatISK } from '@/lib/bills-utils'
import toast from '@/lib/toast'

import type { KeyboardEvent } from 'react'
import type { BillPayment, BillWithDetails } from '@repo/bills'
import type { DataTableColumn } from '@/components/data-table'

export interface BillDetailActions {
	pending?: boolean
	onIssue?: () => void
	onMarkPaid?: () => void
	onRevertToDraft?: () => void
	onCancel?: () => void
	onDelete?: () => void
	canRevertToDraft?: boolean
	editHref?: string
}

interface BillDetailContentProps {
	bill: BillWithDetails
	backHref: string
	actions?: BillDetailActions
}

function formatAmount(amount: string) {
	return formatISK(amount)
}

function parseAmountToMinorUnits(value: string): bigint {
	const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/)
	if (!match) return 0n
	return BigInt(match[1]) * 100n + BigInt(`${match[2] ?? ''}00`.slice(0, 2))
}

function formatMinorUnits(value: bigint): string {
	const whole = value / 100n
	const fraction = (value % 100n).toString().padStart(2, '0')
	return formatISK(`${whole}.${fraction}`)
}

function formatDate(date: Date) {
	return localizedDate(date, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	})
}

function formatDateTime(date: Date) {
	return localizedDateTime(date, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export function BillDetailContent({ bill, backHref, actions }: BillDetailContentProps) {
	const { t } = useAppTranslation()
	const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(
		() => () => {
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
		},
		[]
	)
	const [copiedField, setCopiedField] = useState<'amount' | 'payee' | 'token' | null>(null)
	const totalDueMinor = parseAmountToMinorUnits(bill.amount) + parseAmountToMinorUnits(bill.lateFee)
	const totalPaidMinor =
		bill.payments?.reduce((sum, payment) => sum + parseAmountToMinorUnits(payment.amount), 0n) ?? 0n
	const remainingMinor = totalDueMinor > totalPaidMinor ? totalDueMinor - totalPaidMinor : 0n
	const paymentProgress =
		totalDueMinor > 0n ? Math.min(100, Number((totalPaidMinor * 100n) / totalDueMinor)) : 0

	const copyField = async (field: 'amount' | 'payee' | 'token') => {
		const payeeValue = bill.payeeName || (bill.payeeId && bill.payeeType ? bill.payeeId : '')
		const value =
			field === 'amount' ? bill.amount : field === 'payee' ? payeeValue : bill.paymentToken
		const successKey =
			field === 'amount'
				? ('bills.copy.amountCopied' as const)
				: field === 'payee'
					? ('bills.copy.payeeCopied' as const)
					: ('bills.copy.tokenCopied' as const)

		if (!value) {
			toast.error(<BillFeedback messageKey="bills.copy.empty" />)
			return
		}
		try {
			await navigator.clipboard.writeText(value)
			setCopiedField(field)
			toast.success(<BillFeedback messageKey={successKey} />)
			if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
			copyTimerRef.current = setTimeout(() => setCopiedField(null), 700)
		} catch {
			toast.error(<BillFeedback messageKey="bills.copy.failed" />)
		}
	}

	const paymentColumns: Array<DataTableColumn<BillPayment>> = [
		{
			id: 'date',
			header: t('bills.columns.date'),
			cell: (payment) => formatDateTime(payment.paidAt),
		},
		{
			id: 'amount',
			header: t('bills.columns.amount'),
			cell: (payment) => formatAmount(payment.amount),
			className: 'font-medium',
		},
		{
			id: 'paidBy',
			header: t('bills.columns.paidBy'),
			cell: (payment) =>
				payment.paidById === 'system'
					? t('bills.payment.system')
					: payment.paidByName ||
						t('bills.entityWithId', {
							type: formatEntityType(payment.paidByType),
							id: payment.paidById,
						}),
		},
		{
			id: 'transaction',
			header: t('bills.columns.transaction'),
			cell: (payment) => payment.esiTransactionId,
			className: 'font-mono text-sm',
		},
	]

	const copyCardClass = (field: 'amount' | 'payee' | 'token') =>
		`min-h-[88px] rounded-md border-2 p-3 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex flex-col justify-between ${
			copiedField === field
				? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
				: field === 'token'
					? 'border-zinc-500/60 bg-zinc-500/25 shadow-sm hover:border-zinc-500/80 hover:bg-zinc-500/35 hover:shadow-md'
					: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30 hover:shadow-md'
		}`

	const copyCardProps = (field: 'amount' | 'payee' | 'token') => ({
		role: 'button' as const,
		tabIndex: 0,
		onClick: () => void copyField(field),
		onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault()
				void copyField(field)
			}
		},
		className: copyCardClass(field),
		title: t(`bills.copy.${field}`),
		'aria-label': t(`bills.copy.${field}`),
	})

	return (
		<div className="space-y-6 [overflow-wrap:anywhere]">
			<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
				<div>
					<h1 className="text-3xl font-bold gradient-text break-words">{bill.title}</h1>
					<p className="text-muted-foreground mt-2">{t('bills.id', { id: bill.id })}</p>
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					<Button variant="ghost" asChild>
						<Link to={backHref}>
							<ArrowLeft className="h-4 w-4" />
							{t('bills.back')}
						</Link>
					</Button>
					{actions?.onIssue && bill.status === 'draft' && (
						<Button variant="confirm" disabled={actions.pending} onClick={actions.onIssue}>
							{t('bills.actions.issue')}
						</Button>
					)}
					{actions?.onMarkPaid &&
						bill.status !== 'draft' &&
						bill.status !== 'paid' &&
						bill.status !== 'cancelled' && (
							<Button variant="confirm" disabled={actions.pending} onClick={actions.onMarkPaid}>
								{t('bills.actions.markPaid')}
							</Button>
						)}
					{actions?.onRevertToDraft &&
						actions.canRevertToDraft !== false &&
						bill.status !== 'draft' &&
						bill.status !== 'paid' && (
							<Button
								variant="secondary"
								disabled={actions.pending}
								onClick={actions.onRevertToDraft}
							>
								{t('bills.actions.draft')}
							</Button>
						)}
					{actions?.onCancel && bill.status !== 'paid' && bill.status !== 'cancelled' && (
						<Button variant="cancel" disabled={actions.pending} onClick={actions.onCancel}>
							{t('bills.actions.cancel')}
						</Button>
					)}
					{actions?.onDelete && bill.status === 'draft' && (
						<Button variant="destructive" disabled={actions.pending} onClick={actions.onDelete}>
							{t('bills.actions.delete')}
						</Button>
					)}
					{actions?.editHref && bill.status === 'draft' && (
						<Button variant="ghost" asChild>
							<Link to={actions.editHref}>
								<Edit className="h-4 w-4" />
								{t('bills.actions.edit')}
							</Link>
						</Button>
					)}
				</div>
			</div>

			<div>
				<BillStatusBadge status={bill.status} />
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{t('bills.details')}</CardTitle>
					<CardDescription>{t('bills.detailsDescription')}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.columns.payer')}
							</h3>
							<p className="text-base leading-6 font-semibold">
								{bill.payerName ||
									t('bills.entityWithId', {
										type: formatEntityType(bill.payerType),
										id: bill.payerId,
									})}
							</p>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.columns.issuer')}
							</h3>
							<p className="text-base leading-6 font-semibold">
								{bill.issuerName || bill.issuerId}
							</p>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.columns.dueDate')}
							</h3>
							<p className="text-base leading-6 font-semibold">{formatDate(bill.dueDate)}</p>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.columns.payee')}
							</h3>
							<div {...copyCardProps('payee')}>
								<p className="text-xl leading-6 font-semibold break-words">
									{bill.payeeName ||
										(bill.payeeId && bill.payeeType
											? t('bills.entityWithId', {
													type: formatEntityType(bill.payeeType),
													id: bill.payeeId,
												})
											: '-')}
								</p>
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									{t('bills.copy.hint')}
								</p>
							</div>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.columns.amount')}
							</h3>
							<div {...copyCardProps('amount')}>
								<p className="text-xl font-semibold">{formatAmount(bill.amount)}</p>
								{parseAmountToMinorUnits(bill.lateFee) > 0n && (
									<p className="mt-1 text-xs text-orange-500">
										{t('bills.late.added', { amount: formatAmount(bill.lateFee) })}
									</p>
								)}
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									{t('bills.copy.hint')}
								</p>
							</div>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.payment.token')}
							</h3>
							<div {...copyCardProps('token')}>
								<p
									className="break-all font-mono text-xl font-semibold tracking-[0.2em]"
									style={{ fontVariantNumeric: 'slashed-zero tabular-nums' }}
								>
									{bill.paymentToken}
								</p>
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									{t('bills.copy.hint')}
								</p>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{bill.description && (
							<div className="md:col-span-2">
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.columns.description')}
								</h3>
								<p className="text-base leading-6">{bill.description}</p>
							</div>
						)}
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">
								{t('bills.columns.created')}
							</h3>
							<p className="text-base leading-6">{formatDate(bill.createdAt)}</p>
						</div>
						{bill.paidAt && (
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.columns.paidAt')}
								</h3>
								<p className="text-base leading-6">{formatDate(bill.paidAt)}</p>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{bill.status !== 'draft' && (
				<Card>
					<CardHeader>
						<CardTitle>{t('bills.payment.summary')}</CardTitle>
						<CardDescription>{t('bills.payment.summaryDescription')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 gap-6 md:grid-cols-3">
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.payment.totalDue')}
								</h3>
								<p className="text-xl font-bold">{formatMinorUnits(totalDueMinor)}</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.payment.totalPaid')}
								</h3>
								<p className="text-xl font-bold text-green-500">
									{formatMinorUnits(totalPaidMinor)}
								</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.payment.remaining')}
								</h3>
								<p
									className={`text-xl font-bold ${remainingMinor > 0n ? 'text-orange-500' : 'text-green-500'}`}
								>
									{formatMinorUnits(remainingMinor)}
								</p>
							</div>
						</div>
						<div className="space-y-2">
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">{t('bills.payment.progress')}</span>
								<span className="font-medium">
									{formatNumber(paymentProgress / 100, {
										style: 'percent',
										minimumFractionDigits: 1,
										maximumFractionDigits: 1,
									})}
								</span>
							</div>
							<Progress
								aria-label={t('bills.payment.progress')}
								value={paymentProgress}
								className="h-2 bg-warning/70"
							/>
						</div>
					</CardContent>
				</Card>
			)}

			{bill.lateFeeType !== 'none' && (
				<Card>
					<CardHeader>
						<CardTitle>{t('bills.late.title')}</CardTitle>
						<CardDescription>{t('bills.late.description')}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.late.type')}
								</h3>
								<p className="text-lg">
									{bill.lateFeeType === 'static'
										? t('bills.late.static')
										: t('bills.late.percentage')}
								</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.late.amount')}
								</h3>
								<p className="text-lg">
									{bill.lateFeeType === 'percentage'
										? formatNumber(Number(bill.lateFeeAmount) / 100, {
												style: 'percent',
												maximumFractionDigits: 2,
											})
										: formatAmount(bill.lateFeeAmount)}
								</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">
									{t('bills.late.compounding')}
								</h3>
								<p className="text-lg">{t(`bills.late.${bill.lateFeeCompounding}`)}</p>
							</div>
							{bill.lateFee !== '0' && (
								<div>
									<h3 className="mb-1 text-sm font-medium text-muted-foreground">
										{t('bills.late.current')}
									</h3>
									<p className="text-lg font-bold text-orange-500">{formatAmount(bill.lateFee)}</p>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{bill.status !== 'draft' && (
				<Card>
					<CardHeader>
						<CardTitle>{t('bills.payment.history')}</CardTitle>
						<CardDescription>
							{bill.payments && bill.payments.length > 0
								? t('bills.payment.recorded', {
										count: bill.payments.length,
										formattedCount: formatNumber(bill.payments.length),
									})
								: t('bills.payment.none')}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<DataTable
							columns={paymentColumns}
							rows={bill.payments ?? []}
							getRowKey={(payment) => payment.id}
							emptyMessage={t('bills.payment.empty')}
							variant="plain"
						/>
						{!bill.payments?.length && (
							<p className="mt-1 text-center text-sm text-muted-foreground">
								{t('bills.payment.emptyHelp')}
							</p>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}

export function BillDetailState({
	isLoading,
	error,
	backHref,
}: {
	isLoading: boolean
	error: unknown
	backHref: string
}) {
	const { t } = useAppTranslation()
	if (isLoading) {
		return (
			<div className="space-y-6 [overflow-wrap:anywhere]">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
					<h1 className="text-3xl font-bold gradient-text break-words">{t('bills.loading')}</h1>
					<BackToBills href={backHref} />
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="space-y-6 [overflow-wrap:anywhere]">
				<div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
					<div>
						<h1 className="text-3xl font-bold gradient-text break-words">{t('bills.notFound')}</h1>
						<p className="mt-2 text-muted-foreground">{t('bills.unavailable')}</p>
					</div>
					<BackToBills href={backHref} />
				</div>
			</div>
		)
	}

	return null
}

function BackToBills({ href }: { href: string }) {
	const { t } = useAppTranslation()
	return (
		<Button variant="ghost" asChild>
			<Link to={href}>
				<ArrowLeft className="h-4 w-4" />
				{t('bills.back')}
			</Link>
		</Button>
	)
}
