import { FileText } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import toast from '@/lib/toast'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Progress } from '@/components/ui/progress'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'

import { useBill } from '../hooks'

export default function BillDetailPage() {
	const { billId } = useParams<{ billId: string }>()
	const { user } = useAuth()
	const { data: bill, isLoading, error } = useBill(billId!)
	const [copiedField, setCopiedField] = useState<'amount' | 'payee' | 'token' | null>(null)

	usePageTitle(bill ? `Bill - ${bill.title}` : 'Bill Details')

	if (
		user?.is_admin &&
		billId &&
		!isLoading &&
		!bill &&
		error instanceof Error &&
		error.message === 'Forbidden'
	) {
		return <Navigate to={`/admin/bills/${billId}`} replace />
	}

	if (isLoading) {
		return (
			<Container>
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Loading Bill...</h1>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/my-bills">
							<FileText className="h-4 w-4" />
							Back to My Bills
						</Link>
					</Button>
				</div>
			</Container>
		)
	}

	if (error || !bill) {
		return (
			<Container>
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Bill Not Found</h1>
						<p className="text-muted-foreground mt-2">
							The bill you're looking for doesn't exist or you don't have permission to view it.
						</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/my-bills">
							<FileText className="h-4 w-4" />
							Back to My Bills
						</Link>
					</Button>
				</div>
			</Container>
		)
	}

	const formatAmount = (amount: string) => {
		return new Intl.NumberFormat('en-US').format(Number(amount))
	}

	const formatDate = (date: Date) => {
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
		})
	}

	const formatDateTime = (date: Date) => {
		return new Date(date).toLocaleString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		})
	}

	// Calculate payment summary
	const totalDue = Number(bill.amount) + Number(bill.lateFee)
	const totalPaid = bill.payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0
	const remaining = Math.max(0, totalDue - totalPaid)
	const paymentProgress = totalDue > 0 ? Math.min(100, Math.floor((totalPaid / totalDue) * 100)) : 0

	const copyField = async (field: 'amount' | 'payee' | 'token') => {
		const payeeValue = bill.payeeName || (bill.payeeId && bill.payeeType ? bill.payeeId : '')
		const value = field === 'amount' ? bill.amount : field === 'payee' ? payeeValue : bill.paymentToken
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

	return (
		<Container>
			{/* Page Header */}
			<PageHeader
				title={bill.title}
				description={`Bill ID: ${bill.id}`}
				action={
					<Button variant="ghost" asChild>
						<Link to="/my-bills">
							<FileText className="h-4 w-4" />
							Back to My Bills
						</Link>
					</Button>
				}
			/>

			{/* Status Badge */}
			<div className="mb-6">
				<BillStatusBadge status={bill.status} />
			</div>

			{/* Bill Details */}
			<Card className="mb-6">
				<CardHeader>
					<CardTitle>Bill Details</CardTitle>
					<CardDescription>Information about this bill</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Payer</h3>
							<p className="text-base leading-6 font-semibold">
								{bill.payerName ||
									`${bill.payerType.charAt(0).toUpperCase() + bill.payerType.slice(1)} ${bill.payerId}`}
							</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Issuer</h3>
							<p className="text-base leading-6 font-semibold">{bill.issuerName || bill.issuerId}</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Due Date</h3>
							<p className="text-base leading-6 font-semibold">{formatDate(bill.dueDate)}</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Payee</h3>
							<div
								role="button"
								tabIndex={0}
								onClick={() => void copyField('payee')}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault()
										void copyField('payee')
									}
								}}
								className={`min-h-[88px] rounded-md border-2 p-3 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex flex-col justify-between ${
									copiedField === 'payee'
										? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
										: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30 hover:shadow-md'
								}`}
								title="Copy payee"
							>
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
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Amount</h3>
							<div
								role="button"
								tabIndex={0}
								onClick={() => void copyField('amount')}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault()
										void copyField('amount')
									}
								}}
								className={`min-h-[88px] rounded-md border-2 p-3 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex flex-col justify-between ${
									copiedField === 'amount'
										? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
										: 'border-zinc-500/50 bg-zinc-500/20 shadow-sm hover:border-zinc-500/70 hover:bg-zinc-500/30 hover:shadow-md'
								}`}
								title="Copy amount"
							>
								<p className="text-xl font-semibold">{formatAmount(bill.amount)} ISK</p>
								{Number(bill.lateFee) > 0 && (
									<p className="text-xs text-orange-500 mt-1">
										+{formatAmount(bill.lateFee)} ISK late fee
									</p>
								)}
								<p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
									Click to copy
								</p>
							</div>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Payment Token</h3>
							<div
								role="button"
								tabIndex={0}
								onClick={() => void copyField('token')}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault()
										void copyField('token')
									}
								}}
								className={`min-h-[88px] rounded-md border-2 p-3 text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex flex-col justify-between ${
									copiedField === 'token'
										? 'border-teal-500 bg-teal-500/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]'
										: 'border-zinc-500/60 bg-zinc-500/25 shadow-sm hover:border-zinc-500/80 hover:bg-zinc-500/35 hover:shadow-md'
								}`}
								title="Copy payment token"
							>
								<p
									className="text-xl font-mono font-semibold break-all tracking-[0.2em]"
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

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{bill.description && (
							<div className="md:col-span-2">
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
								<p className="text-base leading-6">{bill.description}</p>
							</div>
						)}

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
							<p className="text-base leading-6">{formatDate(bill.createdAt)}</p>
						</div>

						{bill.paidAt && (
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Paid At</h3>
								<p className="text-base leading-6">{formatDate(bill.paidAt)}</p>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Payment Summary */}
			<Card className="mb-6">
				<CardHeader>
					<CardTitle>Payment Summary</CardTitle>
					<CardDescription>Payment progress for this bill</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Total Due</h3>
							<p className="text-xl font-bold">{formatAmount(totalDue.toString())} ISK</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Total Paid</h3>
							<p className="text-xl font-bold text-green-500">
								{formatAmount(totalPaid.toString())} ISK
							</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Remaining</h3>
							<p
								className={`text-xl font-bold ${remaining > 0 ? 'text-orange-500' : 'text-green-500'}`}
							>
								{formatAmount(remaining.toString())} ISK
							</p>
						</div>
					</div>

					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span className="text-muted-foreground">Payment Progress</span>
							<span className="font-medium">{paymentProgress.toFixed(1)}%</span>
						</div>
						<Progress value={paymentProgress} className="h-2" />
					</div>
				</CardContent>
			</Card>

			{/* Payment History */}
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
										<TableCell className="font-medium">
											{formatAmount(payment.amount)} ISK
										</TableCell>
										<TableCell>
											{payment.paidByName ||
												`${payment.paidByType.charAt(0).toUpperCase() + payment.paidByType.slice(1)} ${payment.paidById}`}
										</TableCell>
										<TableCell className="font-mono text-sm">{payment.esiTransactionId}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<div className="text-center py-8 text-muted-foreground">
							<p>No payments have been made yet.</p>
							<p className="text-sm mt-1">Payments will appear here once they are processed.</p>
						</div>
					)}
				</CardContent>
			</Card>
		</Container>
	)
}
