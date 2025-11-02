import { FileText } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useBill } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function AdminBillsDetailPage() {
	const { billId } = useParams<{ billId: string }>()
	const { data: bill, isLoading, error } = useBill(billId!)

	usePageTitle(bill ? `Bill - ${bill.title}` : 'Bill Details')

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-3xl font-bold gradient-text">Loading Bill...</h1>
					</div>
					<Button variant="outline" asChild>
						<Link to="/admin/bills">
							<FileText className="mr-2 h-4 w-4" />
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
					<Button variant="outline" asChild>
						<Link to="/admin/bills">
							<FileText className="mr-2 h-4 w-4" />
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

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{bill.title}</h1>
					<p className="text-muted-foreground mt-2">
						Bill ID: {bill.id}
					</p>
				</div>
				<Button variant="outline" asChild>
					<Link to="/admin/bills">
						<FileText className="mr-2 h-4 w-4" />
						Back to Bills
					</Link>
				</Button>
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
								{bill.payerType.charAt(0).toUpperCase() + bill.payerType.slice(1)} ID: {bill.payerId}
							</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-muted-foreground mb-1">Issuer</h3>
							<p className="text-lg">{bill.issuerId}</p>
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

			{/* Payment Token */}
			{bill.status !== 'paid' && bill.status !== 'cancelled' && (
				<Card variant="interactive">
					<CardHeader>
						<CardTitle>Payment Token</CardTitle>
						<CardDescription>Use this token to pay the bill</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="font-mono bg-muted p-3 rounded-md break-all">
							{bill.paymentToken}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	)
}
