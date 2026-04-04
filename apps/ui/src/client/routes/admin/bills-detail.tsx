import { ArrowLeft, Edit, Users } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

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
import { useBill, useGroupBillAggregate } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function AdminBillsDetailPage() {
	const { billId } = useParams<{ billId: string }>()
	const [searchParams] = useSearchParams()
	const forceIndividual = searchParams.get('view') === 'individual'

	const { data: bill, isLoading, error } = useBill(billId!)
	const isGroupBillAggregate = Boolean(bill?.groupBillId) && !forceIndividual
	const { data: groupAggregate, isLoading: isGroupLoading } = useGroupBillAggregate(
		isGroupBillAggregate ? bill!.groupBillId! : undefined
	)

	usePageTitle(bill ? `Bill - ${bill.title}` : 'Bill Details')

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Loading Bill...</h1>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
		)
	}

	if (error || !bill) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Bill Not Found</h1>
						<p className="text-muted-foreground mt-2">
							The bill you're looking for doesn't exist or you don't have permission to view it.
						</p>
					</div>
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>
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

	const getStatusBadgeClass = (status: string) => {
		switch (status) {
			case 'draft':
				return 'bg-muted text-muted-foreground'
			case 'issued':
				return 'bg-blue-500/10 text-blue-500'
			case 'paid':
				return 'bg-green-500/10 text-green-500'
			case 'cancelled':
				return 'bg-destructive/10 text-destructive'
			case 'overdue':
				return 'bg-orange-500/10 text-orange-500'
			default:
				return 'bg-muted text-muted-foreground'
		}
	}

	// --- Group bill aggregate view ---
	if (isGroupBillAggregate) {
		if (isGroupLoading || !groupAggregate) {
			return (
				<div className="space-y-6">
					<div className="flex items-center justify-between">
						<div>
							<h1 className="text-3xl font-bold gradient-text">Loading Group Bill...</h1>
						</div>
						<Button variant="ghost" asChild>
							<Link to="/admin/bills">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back to Bills
							</Link>
						</Button>
					</div>
				</div>
			)
		}

		const groupProgress =
			groupAggregate.totalBills > 0
				? Math.min(100, Math.floor((groupAggregate.paidBills / groupAggregate.totalBills) * 100))
				: 0

		return (
			<div className="space-y-6">
				{/* Page Header */}
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">{groupAggregate.title}</h1>
						<p className="text-muted-foreground mt-2">
							Group Bill · {groupAggregate.groupName ?? groupAggregate.groupId}
						</p>
					</div>
					<div className="flex gap-2">
						<Button variant="ghost" asChild>
							<Link to={`/admin/bills/group/${bill.groupBillId}/edit`}>
								<Edit className="mr-2 h-4 w-4" />
								Edit Group
							</Link>
						</Button>
						<Button variant="ghost" asChild>
							<Link to="/admin/bills">
								<ArrowLeft className="mr-2 h-4 w-4" />
								Back to Bills
							</Link>
						</Button>
					</div>
				</div>

				{/* Group Bill Badge */}
				<div className="flex items-center gap-2">
					<span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-sm font-medium text-blue-500">
						<Users className="h-3.5 w-3.5" />
						Group Bill
					</span>
					<span className="text-sm text-muted-foreground">
						Issued by {groupAggregate.issuerName ?? groupAggregate.issuerId}
					</span>
				</div>

				{/* Bill Details */}
				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Bill Details</CardTitle>
						<CardDescription>Shared details for all members of this group bill</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">
									Amount (per member)
								</h3>
								<p className="text-2xl font-bold">{formatAmount(groupAggregate.amount)} ISK</p>
							</div>
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Due Date</h3>
								<p className="text-lg">{formatDate(groupAggregate.dueDate)}</p>
							</div>
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Group</h3>
								<p className="text-lg">{groupAggregate.groupName ?? groupAggregate.groupId}</p>
							</div>
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
								<p className="text-lg">{formatDate(groupAggregate.createdAt)}</p>
							</div>
							{groupAggregate.description && (
								<div className="md:col-span-2">
									<h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
									<p className="text-lg">{groupAggregate.description}</p>
								</div>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Group Payment Progress */}
				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Group Payment Progress</CardTitle>
						<CardDescription>
							{groupAggregate.paidBills} of {groupAggregate.totalBills} members paid
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<div className="flex justify-between text-sm">
								<span className="text-muted-foreground">Overall Progress</span>
								<span className="font-medium">{groupProgress}%</span>
							</div>
							<Progress value={groupProgress} className="h-2" />
						</div>

						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Member</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Amount Due</TableHead>
									<TableHead>Amount Paid</TableHead>
									<TableHead>Paid At</TableHead>
									<TableHead>Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{groupAggregate.bills.map((entry) => (
									<TableRow key={entry.billId}>
										<TableCell>{entry.payerName ?? entry.payerId}</TableCell>
										<TableCell>
											<span
												className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(entry.status)}`}
											>
												{entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
											</span>
										</TableCell>
										<TableCell>{formatAmount(entry.totalDue)} ISK</TableCell>
										<TableCell className="text-green-500">
											{formatAmount(entry.totalPaid)} ISK
										</TableCell>
										<TableCell>{entry.paidAt ? formatDateTime(entry.paidAt) : '—'}</TableCell>
										<TableCell>
											<Button variant="ghost" asChild>
												<Link to={`/admin/bills/${entry.billId}?view=individual`}>View Bill</Link>
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{bill.title}</h1>
					<p className="text-muted-foreground mt-2">Bill ID: {bill.id}</p>
				</div>
				<div className="flex gap-2">
					{bill.status === 'draft' && (
						<Button variant="ghost" asChild>
							<Link to={`/admin/bills/${bill.id}/edit`}>
								<Edit className="mr-2 h-4 w-4" />
								Edit
							</Link>
						</Button>
					)}
					<Button variant="ghost" asChild>
						<Link to="/admin/bills">
							<ArrowLeft className="mr-2 h-4 w-4" />
							Back to Bills
						</Link>
					</Button>
				</div>
			</div>

			{/* Status Badge */}
			<div>
				<span
					className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getStatusBadgeClass(bill.status)}`}
				>
					{bill.status.charAt(0).toUpperCase() + bill.status.slice(1)}
				</span>
			</div>

			{/* Bill Details */}
			<Card variant="interactive">
				<CardHeader>
					<CardTitle>Bill Details</CardTitle>
					<CardDescription>Information about this bill</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Amount</h3>
							<p className="text-2xl font-bold">{formatAmount(bill.amount)} ISK</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Due Date</h3>
							<p className="text-lg">{formatDate(bill.dueDate)}</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Payer</h3>
							<p className="text-lg">
								{bill.payerName ||
									`${bill.payerType.charAt(0).toUpperCase() + bill.payerType.slice(1)} ${bill.payerId}`}
							</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Payee</h3>
							<p className="text-lg">
								{bill.payeeName ||
									(bill.payeeId && bill.payeeType
										? `${bill.payeeType.charAt(0).toUpperCase() + bill.payeeType.slice(1)} ${bill.payeeId}`
										: '-')}
							</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Issuer</h3>
							<p className="text-lg">{bill.issuerName || bill.issuerId}</p>
						</div>

						{bill.description && (
							<div className="md:col-span-2">
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Description</h3>
								<p className="text-lg">{bill.description}</p>
							</div>
						)}

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Created</h3>
							<p className="text-lg">{formatDate(bill.createdAt)}</p>
						</div>

						{bill.paidAt && (
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Paid At</h3>
								<p className="text-lg">{formatDate(bill.paidAt)}</p>
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Payment Summary */}
			{bill.status !== 'draft' && (
				<Card variant="interactive">
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
			)}

			{/* Late Fee Information */}
			{bill.lateFeeType !== 'none' && (
				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Late Fee Information</CardTitle>
						<CardDescription>Penalties for late payment</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Late Fee Type</h3>
								<p className="text-lg">
									{bill.lateFeeType === 'static' ? 'Static Amount' : 'Percentage'}
								</p>
							</div>

							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Late Fee Amount</h3>
								<p className="text-lg">
									{bill.lateFeeType === 'percentage'
										? `${bill.lateFeeAmount}%`
										: `${formatAmount(bill.lateFeeAmount)} ISK`}
								</p>
							</div>

							<div>
								<h3 className="text-sm font-medium text-muted-foreground mb-1">Compounding</h3>
								<p className="text-lg">
									{bill.lateFeeCompounding === 'none'
										? 'None (One-time)'
										: bill.lateFeeCompounding.charAt(0).toUpperCase() +
											bill.lateFeeCompounding.slice(1)}
								</p>
							</div>

							{bill.lateFee !== '0' && (
								<div>
									<h3 className="text-sm font-medium text-muted-foreground mb-1">
										Current Late Fee
									</h3>
									<p className="text-lg text-orange-500 font-bold">
										{formatAmount(bill.lateFee)} ISK
									</p>
								</div>
							)}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Payment History */}
			{bill.status !== 'draft' && (
				<Card variant="interactive">
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
											<TableCell className="font-mono text-sm">
												{payment.esiTransactionId}
											</TableCell>
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
			)}

			{/* Payment Token */}
			{bill.status !== 'paid' && bill.status !== 'cancelled' && (
				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Payment Token</CardTitle>
						<CardDescription>Use this token to pay the bill</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="font-mono bg-muted p-3 rounded-md break-all">{bill.paymentToken}</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
