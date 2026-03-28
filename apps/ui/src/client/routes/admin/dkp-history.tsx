import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useTransactionHistory } from '@/features/dkp'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { DkpFilters, DkpSourceType } from '@/features/dkp'

const SOURCE_TYPE_COLORS: Record<DkpSourceType, string> = {
	fleet: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
	market: 'bg-green-500/10 text-green-500 border-green-500/20',
	mining: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
	manual: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
	adjustment: 'bg-red-500/10 text-red-500 border-red-500/20',
}

export default function DkpHistory() {
	usePageTitle('Admin - DKP Transaction History')

	const [filters, setFilters] = useState<DkpFilters>({
		limit: 50,
		offset: 0,
	})

	const [tempFilters, setTempFilters] = useState({
		userId: '',
		characterId: '',
		corporationId: '',
		sourceType: 'all',
		startDate: '',
		endDate: '',
	})

	const { data, isLoading, error } = useTransactionHistory(filters)

	const page = Math.floor((filters.offset || 0) / (filters.limit || 50))
	const totalPages = data ? Math.ceil(data.pagination.total / (filters.limit || 50)) : 0

	const applyFilters = () => {
		setFilters({
			...filters,
			userId: tempFilters.userId || undefined,
			characterId: tempFilters.characterId || undefined,
			corporationId: tempFilters.corporationId || undefined,
			sourceType:
				tempFilters.sourceType !== 'all' ? (tempFilters.sourceType as DkpSourceType) : undefined,
			startDate: tempFilters.startDate || undefined,
			endDate: tempFilters.endDate || undefined,
			offset: 0,
		})
	}

	const clearFilters = () => {
		setTempFilters({
			userId: '',
			characterId: '',
			corporationId: '',
			sourceType: 'all',
			startDate: '',
			endDate: '',
		})
		setFilters({
			limit: 50,
			offset: 0,
		})
	}

	const hasActiveFilters =
		filters.userId ||
		filters.characterId ||
		filters.corporationId ||
		filters.sourceType ||
		filters.startDate ||
		filters.endDate

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">Transaction History</h1>
				<p className="text-muted-foreground mt-1">View all DKP transactions</p>
			</div>

			{/* Filters */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Filters</CardTitle>
							<CardDescription>Filter transactions by various criteria</CardDescription>
						</div>
						{hasActiveFilters && (
							<Button variant="ghost" size="sm" onClick={clearFilters}>
								<X className="mr-2 h-4 w-4" />
								Clear All
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-3">
						<div className="space-y-2">
							<Label htmlFor="userId">User ID</Label>
							<Input
								id="userId"
								type="text"
								placeholder="User UUID"
								value={tempFilters.userId}
								onChange={(e) => setTempFilters({ ...tempFilters, userId: e.target.value })}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="characterId">Character ID</Label>
							<Input
								id="characterId"
								type="text"
								placeholder="Character ID"
								value={tempFilters.characterId}
								onChange={(e) => setTempFilters({ ...tempFilters, characterId: e.target.value })}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="corporationId">Corporation ID</Label>
							<Input
								id="corporationId"
								type="text"
								placeholder="Corporation ID"
								value={tempFilters.corporationId}
								onChange={(e) => setTempFilters({ ...tempFilters, corporationId: e.target.value })}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="sourceType">Source Type</Label>
							<Select
								value={tempFilters.sourceType}
								onValueChange={(val) => setTempFilters({ ...tempFilters, sourceType: val })}
								inputId="sourceType"
								options={[
									{ value: 'all', label: 'All Types' },
									{ value: 'fleet', label: 'Fleet' },
									{ value: 'market', label: 'Market' },
									{ value: 'mining', label: 'Mining' },
									{ value: 'manual', label: 'Manual' },
									{ value: 'adjustment', label: 'Adjustment' },
								]}
								placeholder="All types"
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="startDate">Start Date</Label>
							<Input
								id="startDate"
								type="date"
								value={tempFilters.startDate}
								onChange={(e) => setTempFilters({ ...tempFilters, startDate: e.target.value })}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="endDate">End Date</Label>
							<Input
								id="endDate"
								type="date"
								value={tempFilters.endDate}
								onChange={(e) => setTempFilters({ ...tempFilters, endDate: e.target.value })}
							/>
						</div>
					</div>

					<div className="flex gap-2 mt-4">
						<Button onClick={applyFilters}>Apply Filters</Button>
						{hasActiveFilters && (
							<Button variant="outline" onClick={clearFilters}>
								Clear
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Transactions Table */}
			<Card>
				<CardHeader>
					<CardTitle>Transactions</CardTitle>
					<CardDescription>
						{data
							? `Showing ${data.transactions.length} of ${data.pagination.total} transactions`
							: 'Loading...'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{error && (
						<p className="text-destructive">Failed to load transactions: {error.message}</p>
					)}

					{isLoading && (
						<div className="space-y-2">
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
						</div>
					)}

					{!isLoading && !error && (
						<>
							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Date</TableHead>
											<TableHead>Character</TableHead>
											<TableHead>Corporation</TableHead>
											<TableHead className="text-right">Amount</TableHead>
											<TableHead>Source</TableHead>
											<TableHead>Reason</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data?.transactions.map((tx) => (
											<TableRow key={tx.id}>
												<TableCell className="text-xs text-muted-foreground">
													{new Date(tx.earnedAt).toLocaleDateString()}
													<br />
													{new Date(tx.earnedAt).toLocaleTimeString()}
												</TableCell>
												<TableCell>
													<div className="text-sm">{tx.characterName}</div>
													<div className="text-xs text-muted-foreground font-mono">
														{tx.characterId}
													</div>
												</TableCell>
												<TableCell>
													<div className="text-sm">{tx.corporationName}</div>
												</TableCell>
												<TableCell className="text-right">
													<span className={tx.amount > 0 ? 'text-green-500' : 'text-red-500'}>
														{tx.amount > 0 ? '+' : ''}
														{tx.amount.toLocaleString()}
													</span>
												</TableCell>
												<TableCell>
													<Badge variant="outline" className={SOURCE_TYPE_COLORS[tx.sourceType]}>
														{tx.sourceType}
													</Badge>
												</TableCell>
												<TableCell className="max-w-xs truncate text-sm">
													{tx.awardReason || '-'}
												</TableCell>
											</TableRow>
										))}
										{data?.transactions.length === 0 && (
											<TableRow>
												<TableCell colSpan={6} className="text-center text-muted-foreground h-24">
													No transactions found
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
							</div>

							{/* Pagination */}
							{totalPages > 1 && (
								<div className="flex items-center justify-between mt-4">
									<p className="text-sm text-muted-foreground">
										Page {page + 1} of {totalPages}
									</p>
									<div className="flex gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setFilters({ ...filters, offset: Math.max(0, (filters.offset || 0) - 50) })
											}
											disabled={page === 0}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setFilters({ ...filters, offset: (filters.offset || 0) + 50 })}
											disabled={page >= totalPages - 1}
										>
											Next
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
