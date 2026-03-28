import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCorporationLeaderboard, useUserLeaderboard } from '@/features/dkp'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { DkpPeriod } from '@/features/dkp'

export default function DkpLeaderboards() {
	usePageTitle('Admin - DKP Leaderboards')

	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-3xl font-bold gradient-text">DKP Leaderboards</h1>
				<p className="text-muted-foreground mt-1">View top earners</p>
			</div>

			<Tabs defaultValue="users" className="w-full">
				<TabsList className="grid w-full max-w-md grid-cols-2">
					<TabsTrigger value="users">User Leaderboard</TabsTrigger>
					<TabsTrigger value="corporations">Corporation Leaderboard</TabsTrigger>
				</TabsList>

				<TabsContent value="users" className="space-y-4">
					<UserLeaderboard />
				</TabsContent>

				<TabsContent value="corporations" className="space-y-4">
					<CorporationLeaderboard />
				</TabsContent>
			</Tabs>
		</div>
	)
}

function UserLeaderboard() {
	const [period, setPeriod] = useState<DkpPeriod>('all')
	const [page, setPage] = useState(0)
	const limit = 50

	const { data, isLoading, error } = useUserLeaderboard({
		period,
		limit,
		offset: page * limit,
	})

	const totalPages = data ? Math.ceil(data.pagination.total / limit) : 0

	return (
		<>
			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex gap-4 items-end">
						<div className="flex-1 max-w-xs space-y-2">
							<label className="text-sm font-medium">Time Period</label>
							<Select
								value={period}
								onValueChange={(val) => {
									setPeriod(val as DkpPeriod)
									setPage(0)
								}}
								options={[
									{ value: 'all', label: 'All Time' },
									{ value: '7d', label: 'Last 7 Days' },
									{ value: '30d', label: 'Last 30 Days' },
									{ value: '90d', label: 'Last 90 Days' },
								]}
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Leaderboard Table */}
			<Card>
				<CardHeader>
					<CardTitle>User Rankings</CardTitle>
					<CardDescription>
						{data
							? `Showing ${data.leaderboard.length} of ${data.pagination.total} users`
							: 'Loading...'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{error && <p className="text-destructive">Failed to load leaderboard: {error.message}</p>}

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
											<TableHead className="w-16">Rank</TableHead>
											<TableHead>Main Character</TableHead>
											<TableHead className="text-right">Balance</TableHead>
											<TableHead className="text-right">Characters</TableHead>
											<TableHead className="text-right">Transactions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data?.leaderboard.map((entry) => (
											<TableRow key={entry.userId}>
												<TableCell className="font-bold">
													{entry.rank <= 3 ? (
														<span
															className={
																entry.rank === 1
																	? 'text-yellow-500'
																	: entry.rank === 2
																		? 'text-gray-400'
																		: 'text-orange-600'
															}
														>
															#{entry.rank}
														</span>
													) : (
														`#${entry.rank}`
													)}
												</TableCell>
												<TableCell>{entry.mainCharacterName}</TableCell>
												<TableCell className="text-right font-mono font-bold text-green-500">
													{entry.balance.toLocaleString()}
												</TableCell>
												<TableCell className="text-right text-muted-foreground">
													{entry.characterCount}
												</TableCell>
												<TableCell className="text-right text-muted-foreground">
													{entry.transactionCount}
												</TableCell>
											</TableRow>
										))}
										{data?.leaderboard.length === 0 && (
											<TableRow>
												<TableCell colSpan={5} className="text-center text-muted-foreground h-24">
													No data available for selected period
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
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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
		</>
	)
}

function CorporationLeaderboard() {
	const [period, setPeriod] = useState<DkpPeriod>('all')
	const [page, setPage] = useState(0)
	const limit = 50

	const { data, isLoading, error } = useCorporationLeaderboard({
		period,
		limit,
		offset: page * limit,
	})

	const totalPages = data ? Math.ceil(data.pagination.total / limit) : 0

	return (
		<>
			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex gap-4 items-end">
						<div className="flex-1 max-w-xs space-y-2">
							<label className="text-sm font-medium">Time Period</label>
							<Select
								value={period}
								onValueChange={(val) => {
									setPeriod(val as DkpPeriod)
									setPage(0)
								}}
								options={[
									{ value: 'all', label: 'All Time' },
									{ value: '7d', label: 'Last 7 Days' },
									{ value: '30d', label: 'Last 30 Days' },
									{ value: '90d', label: 'Last 90 Days' },
								]}
							/>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Leaderboard Table */}
			<Card>
				<CardHeader>
					<CardTitle>Corporation Rankings</CardTitle>
					<CardDescription>
						{data
							? `Showing ${data.leaderboard.length} of ${data.pagination.total} corporations`
							: 'Loading...'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{error && <p className="text-destructive">Failed to load leaderboard: {error.message}</p>}

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
											<TableHead className="w-16">Rank</TableHead>
											<TableHead>Corporation</TableHead>
											<TableHead className="text-right">Total DKP</TableHead>
											<TableHead className="text-right">Members</TableHead>
											<TableHead className="text-right">Avg/Member</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{data?.leaderboard.map((entry) => (
											<TableRow key={entry.corporationId}>
												<TableCell className="font-bold">
													{entry.rank <= 3 ? (
														<span
															className={
																entry.rank === 1
																	? 'text-yellow-500'
																	: entry.rank === 2
																		? 'text-gray-400'
																		: 'text-orange-600'
															}
														>
															#{entry.rank}
														</span>
													) : (
														`#${entry.rank}`
													)}
												</TableCell>
												<TableCell>{entry.corporationName}</TableCell>
												<TableCell className="text-right font-mono font-bold text-green-500">
													{entry.balance.toLocaleString()}
												</TableCell>
												<TableCell className="text-right text-muted-foreground">
													{entry.memberCount}
												</TableCell>
												<TableCell className="text-right font-mono">
													{entry.averagePerMember.toLocaleString()}
												</TableCell>
											</TableRow>
										))}
										{data?.leaderboard.length === 0 && (
											<TableRow>
												<TableCell colSpan={5} className="text-center text-muted-foreground h-24">
													No data available for selected period
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
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<ChevronLeft className="h-4 w-4" />
											Previous
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
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
		</>
	)
}
