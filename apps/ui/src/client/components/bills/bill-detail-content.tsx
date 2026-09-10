import { ArrowLeft, Edit } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatISK } from '@/lib/bills-utils'
import toast from '@/lib/toast'

import type { KeyboardEvent } from 'react'
import type { BillWithDetails } from '@repo/bills'

export interface BillDetailActions {
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
	return new Date(date).toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	})
}

function formatDateTime(date: Date) {
	return new Date(date).toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

export function BillDetailContent({ bill, backHref, actions }: BillDetailContentProps) {
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
		const successMessage =
			field === 'amount'
				? 'Amount copied to clipboard'
				: field === 'payee'
					? 'Payee copied to clipboard'
					: 'Payment token copied to clipboard'

		if (!value) {
			toast.error('No value to copy')
			return
		}
		try {
			await navigator.clipboard.writeText(value)
			setCopiedField(field)
			toast.success(successMessage)
			setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 700)
		} catch {
			toast.error('Failed to copy value')
		}
	}

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
		title: `Copy ${field}`,
	})

	return (
		<div className="space-y-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{bill.title}</h1>
					<p className="text-muted-foreground mt-2">Bill ID: {bill.id}</p>
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					<Button variant="ghost" asChild>
						<Link to={backHref}>
							<ArrowLeft className="h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
					{actions?.onIssue && bill.status === 'draft' && (
						<Button variant="confirm" onClick={actions.onIssue}>
							Issue
						</Button>
					)}
					{actions?.onMarkPaid &&
						bill.status !== 'draft' &&
						bill.status !== 'paid' &&
						bill.status !== 'cancelled' && (
							<Button variant="confirm" onClick={actions.onMarkPaid}>
								Mark Paid
							</Button>
						)}
					{actions?.onRevertToDraft &&
						actions.canRevertToDraft !== false &&
						bill.status !== 'draft' &&
						bill.status !== 'paid' && (
							<Button variant="secondary" onClick={actions.onRevertToDraft}>
								To Draft
							</Button>
						)}
					{actions?.onCancel && bill.status !== 'paid' && bill.status !== 'cancelled' && (
						<Button variant="cancel" onClick={actions.onCancel}>
							Cancel
						</Button>
					)}
					{actions?.onDelete && bill.status === 'draft' && (
						<Button variant="destructive" onClick={actions.onDelete}>
							Delete
						</Button>
					)}
					{actions?.editHref && bill.status === 'draft' && (
						<Button variant="ghost" asChild>
							<Link to={actions.editHref}>
								<Edit className="h-4 w-4" />
								Edit
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
					<CardTitle>Bill Details</CardTitle>
					<CardDescription>Information about this bill</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Payer</h3>
							<p className="text-base leading-6 font-semibold">
								{bill.payerName ||
									`${bill.payerType.charAt(0).toUpperCase() + bill.payerType.slice(1)} ${bill.payerId}`}
							</p>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Issuer</h3>
							<p className="text-base leading-6 font-semibold">
								{bill.issuerName || bill.issuerId}
							</p>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Due Date</h3>
							<p className="text-base leading-6 font-semibold">{formatDate(bill.dueDate)}</p>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Payee</h3>
							<div {...copyCardProps('payee')}>
								<p className="text-xl leading-6 font-semibold break-words">
									{bill.payeeName ||
										(bill.payeeId && bill.payeeType
											? `${bill.payeeType.charAt(0).toUpperCase() + bill.payeeType.slice(1)} ${bill.payeeId}`
											: '-')}
								</p>
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									Click to copy
								</p>
							</div>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Amount</h3>
							<div {...copyCardProps('amount')}>
								<p className="text-xl font-semibold">{formatAmount(bill.amount)}</p>
								{parseAmountToMinorUnits(bill.lateFee) > 0n && (
									<p className="mt-1 text-xs text-orange-500">
										+{formatAmount(bill.lateFee)} late fee
									</p>
								)}
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									Click to copy
								</p>
							</div>
						</div>
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Payment Token</h3>
							<div {...copyCardProps('token')}>
								<p
									className="break-all font-mono text-xl font-semibold tracking-[0.2em]"
									style={{ fontVariantNumeric: 'slashed-zero tabular-nums' }}
								>
									{bill.paymentToken}
								</p>
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									Click to copy
								</p>
							</div>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
						{bill.description && (
							<div className="md:col-span-2">
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Description</h3>
								<p className="text-base leading-6">{bill.description}</p>
							</div>
						)}
						<div>
							<h3 className="mb-1 text-sm font-medium text-muted-foreground">Created</h3>
							<p className="text-base leading-6">{formatDate(bill.createdAt)}</p>
						</div>
						{bill.paidAt && (
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Paid At</h3>
								<p className="text-base leading-6">{formatDate(bill.paidAt)}</p>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{bill.status !== 'draft' && (
				<Card>
					<CardHeader>
						<CardTitle>Payment Summary</CardTitle>
						<CardDescription>Payment progress for this bill</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 gap-6 md:grid-cols-3">
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Total Due</h3>
								<p className="text-xl font-bold">{formatMinorUnits(totalDueMinor)}</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Total Paid</h3>
								<p className="text-xl font-bold text-green-500">
									{formatMinorUnits(totalPaidMinor)}
								</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Remaining</h3>
								<p
									className={`text-xl font-bold ${remainingMinor > 0n ? 'text-orange-500' : 'text-green-500'}`}
								>
									{formatMinorUnits(remainingMinor)}
								</p>
							</div>
						</div>
						<div className="space-y-2">
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Payment Progress</span>
								<span className="font-medium">{paymentProgress.toFixed(1)}%</span>
							</div>
							<Progress value={paymentProgress} className="h-2 bg-warning/70" />
						</div>
					</CardContent>
				</Card>
			)}

			{bill.lateFeeType !== 'none' && (
				<Card>
					<CardHeader>
						<CardTitle>Late Fee Information</CardTitle>
						<CardDescription>Penalties for late payment</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Late Fee Type</h3>
								<p className="text-lg">
									{bill.lateFeeType === 'static' ? 'Static Amount' : 'Percentage'}
								</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Late Fee Amount</h3>
								<p className="text-lg">
									{bill.lateFeeType === 'percentage'
										? `${bill.lateFeeAmount}%`
										: formatAmount(bill.lateFeeAmount)}
								</p>
							</div>
							<div>
								<h3 className="mb-1 text-sm font-medium text-muted-foreground">Compounding</h3>
								<p className="text-lg">
									{bill.lateFeeCompounding === 'none'
										? 'None (One-time)'
										: bill.lateFeeCompounding.charAt(0).toUpperCase() +
											bill.lateFeeCompounding.slice(1)}
								</p>
							</div>
							{bill.lateFee !== '0' && (
								<div>
									<h3 className="mb-1 text-sm font-medium text-muted-foreground">
										Current Late Fee
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
						<CardTitle>Payment History</CardTitle>
						<CardDescription>
							{bill.payments && bill.payments.length > 0
								? `${bill.payments.length} payment${bill.payments.length > 1 ? 's' : ''} recorded`
								: 'No payments recorded yet'}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{bill.payments && bill.payments.length > 0 ? (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Date</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Paid By</TableHead>
										<TableHead>Transaction ID</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{bill.payments.map((payment) => (
										<TableRow key={payment.id}>
											<TableCell>{formatDateTime(payment.paidAt)}</TableCell>
											<TableCell className="font-medium">{formatAmount(payment.amount)}</TableCell>
											<TableCell>
												{payment.paidById === 'system'
													? 'System'
													: payment.paidByName ||
														`${payment.paidByType.charAt(0).toUpperCase() + payment.paidByType.slice(1)} ${payment.paidById}`}
											</TableCell>
											<TableCell className="font-mono text-sm">
												{payment.esiTransactionId}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						) : (
							<div className="py-8 text-center text-muted-foreground">
								<p>No payments have been made yet.</p>
								<p className="mt-1 text-sm">Payments will appear here once they are processed.</p>
							</div>
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
	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-start justify-between gap-4">
					<h1 className="text-3xl font-bold gradient-text">Loading Bill...</h1>
					<BackToBills href={backHref} />
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="space-y-6">
				<div className="flex items-start justify-between gap-4">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Bill Not Found</h1>
						<p className="mt-2 text-muted-foreground">
							The bill you're looking for doesn't exist or you don't have permission to view it.
						</p>
					</div>
					<BackToBills href={backHref} />
				</div>
			</div>
		)
	}

	return null
}

function BackToBills({ href }: { href: string }) {
	return (
		<Button variant="ghost" asChild>
			<Link to={href}>
				<ArrowLeft className="h-4 w-4" />
				Back to Bills
			</Link>
		</Button>
	)
}
