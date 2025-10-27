import { FileText, Plus, Search, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { BillStatusBadge } from '@/components/bills/bill-status-badge'
import { ISKAmount } from '@/components/bills/isk-amount'
import { Button } from '@/components/ui/button'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DestructiveButton } from '@/components/ui/destructive-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
	useBills,
	useCancelBill,
	useDeleteBill,
	useIssueBill,
} from '@/hooks/useBills'
import { formatDueDate, formatEntityType } from '@/lib/bills-utils'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function AdminBillsPage() {
	usePageTitle('Admin - Bills Management')

	// Filters
	const [filters, setFilters] = useState<{
		status?: string
		payerType?: string
		search?: string
	}>({})

	const [searchInput, setSearchInput] = useState('')

	const { data: bills, isLoading } = useBills(filters)
	const issueBill = useIssueBill()
	const cancelBill = useCancelBill()
	const deleteBill = useDeleteBill()

	// Update filter
	const updateFilter = (key: 'status' | 'payerType', value: string | undefined) => {
		setFilters((prev) => {
			if (!value || value === 'all') {
				const { [key]: _, ...rest } = prev
				return rest
			}
			return { ...prev, [key]: value }
		})
	}

	// Handle search
	const handleSearch = () => {
		// Note: Backend doesn't support text search yet, but we can add it later
		// For now just refresh the list
	}

	const handleSearchKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter') {
			handleSearch()
		}
	}

	// Clear all filters
	const clearFilters = () => {
		setFilters({})
		setSearchInput('')
	}

	const hasActiveFilters = Object.keys(filters).length > 0

	// Action handlers
	const handleIssue = async (billId: string) => {
		try {
			await issueBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to issue bill:', error)
		}
	}

	const handleCancel = async (billId: string) => {
		if (!confirm('Are you sure you want to cancel this bill?')) return
		try {
			await cancelBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to cancel bill:', error)
		}
	}

	const handleDelete = async (billId: string) => {
		if (!confirm('Are you sure you want to delete this bill? This action cannot be undone.')) return
		try {
			await deleteBill.mutateAsync(billId)
		} catch (error) {
			console.error('Failed to delete bill:', error)
		}
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Bills Management</h1>
					<p className="text-muted-foreground mt-1">View and manage all bills</p>
				</div>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link to="/admin/bills/templates">
							<FileText className="mr-2 h-4 w-4" />
							Templates
						</Link>
					</Button>
					<Button variant="outline" asChild>
						<Link to="/admin/bills/schedules">Schedules</Link>
					</Button>
					<Button asChild>
						<Link to="/admin/bills/new">
							<Plus className="mr-2 h-4 w-4" />
							Create Bill
						</Link>
					</Button>
				</div>
			</div>

			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>Filter bills by status, type, and search</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{/* Search Input */}
						<div className="space-y-2">
							<Label htmlFor="search">Search</Label>
							<div className="flex gap-2">
								<Input
									id="search"
									placeholder="Search bills..."
									value={searchInput}
									onChange={(e) => setSearchInput(e.target.value)}
									onKeyPress={handleSearchKeyPress}
								/>
								<Button size="icon" onClick={handleSearch}>
									<Search className="h-4 w-4" />
								</Button>
							</div>
						</div>

						{/* Status Filter */}
						<div className="space-y-2">
							<Label htmlFor="status">Status</Label>
							<Select
								value={filters.status || 'all'}
								onValueChange={(value) => updateFilter('status', value)}
							>
								<SelectTrigger id="status">
									<SelectValue placeholder="All statuses" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All statuses</SelectItem>
									<SelectItem value="draft">Draft</SelectItem>
									<SelectItem value="issued">Issued</SelectItem>
									<SelectItem value="paid">Paid</SelectItem>
									<SelectItem value="cancelled">Cancelled</SelectItem>
									<SelectItem value="overdue">Overdue</SelectItem>
								</SelectContent>
							</Select>
						</div>

						{/* Payer Type Filter */}
						<div className="space-y-2">
							<Label htmlFor="payerType">Payer Type</Label>
							<Select
								value={filters.payerType || 'all'}
								onValueChange={(value) => updateFilter('payerType', value)}
							>
								<SelectTrigger id="payerType">
									<SelectValue placeholder="All types" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All types</SelectItem>
									<SelectItem value="character">Character</SelectItem>
									<SelectItem value="corporation">Corporation</SelectItem>
									<SelectItem value="group">Group</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Clear Filters */}
					{hasActiveFilters && (
						<div className="flex justify-end">
							<Button variant="outline" size="sm" onClick={clearFilters}>
								<X className="mr-2 h-4 w-4" />
								Clear Filters
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Bills Table */}
			<Card>
				<CardHeader>
					<CardTitle>All Bills</CardTitle>
					<CardDescription>
						{bills ? `${bills.length} bill(s) found` : 'Loading...'}
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
							<p className="text-muted-foreground mb-4">
								{hasActiveFilters
									? 'Try adjusting your filters'
									: 'Create your first bill to get started'}
							</p>
							<Button asChild>
								<Link to="/admin/bills/new">
									<Plus className="mr-2 h-4 w-4" />
									Create Bill
								</Link>
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>ID</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Payer</TableHead>
										<TableHead>Amount</TableHead>
										<TableHead>Due Date</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{bills.map((bill) => (
										<TableRow key={bill.id}>
											<TableCell className="font-mono text-sm">
												{bill.id.substring(0, 8)}...
											</TableCell>
											<TableCell>
												<BillStatusBadge status={bill.status} />
											</TableCell>
											<TableCell>
												<div>
													<div className="font-medium">{bill.payerId}</div>
													<div className="text-sm text-muted-foreground">
														{formatEntityType(bill.payerType)}
													</div>
												</div>
											</TableCell>
											<TableCell>
												<ISKAmount amount={bill.amount} className="font-semibold" />
											</TableCell>
											<TableCell>
												<div className="text-sm">{formatDueDate(bill.dueDate)}</div>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													{bill.status === 'draft' && (
														<ConfirmButton
															size="sm"
															showIcon={false}
															onClick={() => handleIssue(bill.id)}
															loading={issueBill.isPending}
														>
															Issue
														</ConfirmButton>
													)}
													{bill.status === 'issued' && (
														<CancelButton
															size="sm"
															showIcon={false}
															onClick={() => handleCancel(bill.id)}
															loading={cancelBill.isPending}
														>
															Cancel
														</CancelButton>
													)}
													{bill.status === 'draft' && (
														<DestructiveButton
															size="sm"
															showIcon={false}
															onClick={() => handleDelete(bill.id)}
															loading={deleteBill.isPending}
														>
															Delete
														</DestructiveButton>
													)}
													<Button size="sm" variant="outline" asChild>
														<Link to={`/admin/bills/${bill.id}`}>View</Link>
													</Button>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
