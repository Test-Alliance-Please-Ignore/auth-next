import { Check, Copy, FileText, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/page-header'
import { Progress } from '@/components/ui/progress'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { usePageTitle } from '@/hooks/usePageTitle'
import { formatDueDate, formatEntityType } from '@/lib/bills-utils'

import { useMyBills } from '../hooks'

import type { BillStatus } from '@repo/bills'

export default function MyBillsPage() {
	usePageTitle('My Bills')
	const navigate = useNavigate()

	// Status filter
	const [status, setStatus] = useState<BillStatus | undefined>(undefined)
	const [copiedToken, setCopiedToken] = useState<string | null>(null)

	const copyToken = async (e: React.MouseEvent, token: string) => {
		e.stopPropagation() // Prevent row click navigation
		await navigator.clipboard.writeText(token)
		setCopiedToken(token)
		setTimeout(() => setCopiedToken(null), 2000)
	}

	const { data: bills, isLoading, error } = useMyBills(status ? { status } : undefined)

	// Calculate payment progress for a bill
	const getPaymentProgress = (bill: {
		amount: string
		lateFee: string
		payments?: Array<{ amount: string }>
	}) => {
		const totalDue = Number(bill.amount) + Number(bill.lateFee)
		const totalPaid = bill.payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0
		return totalDue > 0 ? Math.min(100, Math.floor((totalPaid / totalDue) * 100)) : 0
	}

	// Format amount for display
	const formatAmount = (amount: string) => {
		return new Intl.NumberFormat('en-US').format(Number(amount))
	}

	// Clear filters
	const clearFilters = () => {
		setStatus(undefined)
	}

	const hasActiveFilters = !!status

	return (
		<Container>
			<PageHeader title="My Bills" description="View bills assigned to you or your corporations" />

			{/* Status Filter */}
			<Card className="mb-6">
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>Filter bills by status</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-end gap-4">
						<div className="space-y-2 flex-1 max-w-xs">
							<Label htmlFor="status">Status</Label>
							<Select
								value={status || 'all'}
								onValueChange={(value) => setStatus(value === 'all' ? undefined : (value as BillStatus))}
							>
								<SelectTrigger id="status">
									<SelectValue placeholder="All statuses" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All statuses</SelectItem>
									<SelectItem value="issued">Issued (Due)</SelectItem>
									<SelectItem value="overdue">Overdue</SelectItem>
									<SelectItem value="paid">Paid</SelectItem>
									<SelectItem value="cancelled">Cancelled</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{hasActiveFilters && (
							<Button variant="outline" size="sm" onClick={clearFilters}>
								<X className="mr-2 h-4 w-4" />
								Clear Filters
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Error State */}
			{error && (
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center mb-6">
					<p className="text-sm text-red-500">Failed to load bills</p>
					<p className="text-xs text-muted-foreground">
						{error instanceof Error ? error.message : 'Unknown error'}
					</p>
				</div>
			)}

			{/* Bills Table */}
			<Card>
				<CardHeader>
					<CardTitle>Your Bills</CardTitle>
					<CardDescription>
						{isLoading
							? 'Loading...'
							: bills
								? `${bills.length} bill(s) found`
								: 'No bills found'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex justify-center py-12">
							<div className="text-muted-foreground">Loading bills...</div>
						</div>
					) : !bills || bills.length === 0 ? (
						<div className="text-center py-12">
							<FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
							<h3 className="text-lg font-semibold mb-2">No bills found</h3>
							<p className="text-muted-foreground">
								{hasActiveFilters
									? 'Try adjusting your filters'
									: "You don't have any bills assigned to you"}
							</p>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Title</TableHead>
										<TableHead>Payer</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Due Date</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Payment Token</TableHead>
										<TableHead>Payment Progress</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{bills.map((bill) => {
										const progress = getPaymentProgress(bill)
										const totalDue = Number(bill.amount) + Number(bill.lateFee)
										const totalPaid =
											bill.payments?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0

										return (
											<TableRow
												key={bill.id}
												className="cursor-pointer hover:bg-muted/50"
												onClick={() => navigate(`/my-bills/${bill.id}`)}
											>
												<TableCell>
													<div className="font-medium">{bill.title}</div>
													{bill.description && (
														<div className="text-sm text-muted-foreground truncate max-w-xs">
															{bill.description}
														</div>
													)}
												</TableCell>
												<TableCell>
													<div>
														<div className="font-medium">
															{bill.payerName || bill.payerId}
														</div>
														<div className="text-sm text-muted-foreground">
															{formatEntityType(bill.payerType)}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<ISKAmount amount={bill.amount} className="font-semibold" />
													{Number(bill.lateFee) > 0 && (
														<div className="text-sm text-orange-500">
															+{formatAmount(bill.lateFee)} ISK late fee
														</div>
													)}
												</TableCell>
												<TableCell>
													<div className="text-sm">{formatDueDate(bill.dueDate)}</div>
												</TableCell>
												<TableCell>
													<BillStatusBadge status={bill.status} />
												</TableCell>
												<TableCell>
													{bill.paymentToken ? (
														<Button
															variant="ghost"
															size="sm"
															className="h-7 px-2 font-mono text-xs"
															onClick={(e) => copyToken(e, bill.paymentToken!)}
														>
															{bill.paymentToken.slice(0, 8)}...
															{copiedToken === bill.paymentToken ? (
																<Check className="ml-1 h-3 w-3 text-green-500" />
															) : (
																<Copy className="ml-1 h-3 w-3" />
															)}
														</Button>
													) : (
														<span className="text-muted-foreground text-xs">-</span>
													)}
												</TableCell>
												<TableCell>
													<div className="space-y-1 min-w-[120px]">
														<div className="flex justify-between text-xs">
															<span className="text-muted-foreground">
																{formatAmount(totalPaid.toString())}
															</span>
															<span className="text-muted-foreground">
																{formatAmount(totalDue.toString())} ISK
															</span>
														</div>
														<Progress value={progress} className="h-2" />
														<div className="text-xs text-center text-muted-foreground">
															{progress.toFixed(0)}% paid
														</div>
													</div>
												</TableCell>
											</TableRow>
										)
									})}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</Container>
	)
}
