import { ArrowRight, Award, Coins, TrendingUp, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useDkpStatistics } from '@/features/dkp'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function DkpDashboard() {
	usePageTitle('Admin - DKP Dashboard')

	const { data: stats, isLoading, error } = useDkpStatistics()

	if (error) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold gradient-text">DKP Management</h1>
					<p className="text-muted-foreground mt-1">Dashboard Overview</p>
				</div>
				<Card>
					<CardContent className="pt-6">
						<p className="text-destructive">Failed to load statistics: {error.message}</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">DKP Management</h1>
					<p className="text-muted-foreground mt-1">Dashboard Overview</p>
				</div>
				<div className="flex gap-2">
					<Button asChild>
						<Link to="/admin/dkp/awards">
							<Award className="mr-2 h-4 w-4" />
							Award DKP
						</Link>
					</Button>
				</div>
			</div>

			{/* Statistics Cards */}
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">All Time Total</CardTitle>
						<Coins className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-24" />
						) : (
							<div className="text-2xl font-bold">{stats?.totals.allTime.toLocaleString()}</div>
						)}
						<p className="text-xs text-muted-foreground mt-1">Total DKP awarded</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Last 7 Days</CardTitle>
						<TrendingUp className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-24" />
						) : (
							<div className="text-2xl font-bold">{stats?.totals.last7days.toLocaleString()}</div>
						)}
						<p className="text-xs text-muted-foreground mt-1">Recent activity</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Last 30 Days</CardTitle>
						<TrendingUp className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-24" />
						) : (
							<div className="text-2xl font-bold">{stats?.totals.last30days.toLocaleString()}</div>
						)}
						<p className="text-xs text-muted-foreground mt-1">Monthly total</p>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">Last 90 Days</CardTitle>
						<Users className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<Skeleton className="h-8 w-24" />
						) : (
							<div className="text-2xl font-bold">{stats?.totals.last90days.toLocaleString()}</div>
						)}
						<p className="text-xs text-muted-foreground mt-1">Quarterly total</p>
					</CardContent>
				</Card>
			</div>

			{/* DKP Breakdown by Source Type */}
			<Card>
				<CardHeader>
					<CardTitle>DKP Breakdown by Source</CardTitle>
					<CardDescription>Total DKP awarded by source type</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-2">
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
						</div>
					) : (
						<div className="space-y-4">
							{stats?.breakdown && (
								<>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<div className="h-3 w-3 rounded-full bg-blue-500" />
											<span className="text-sm font-medium">Fleet</span>
										</div>
										<span className="text-sm font-bold">
											{stats.breakdown.fleet.toLocaleString()}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<div className="h-3 w-3 rounded-full bg-green-500" />
											<span className="text-sm font-medium">Market</span>
										</div>
										<span className="text-sm font-bold">
											{stats.breakdown.market.toLocaleString()}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<div className="h-3 w-3 rounded-full bg-yellow-500" />
											<span className="text-sm font-medium">Mining</span>
										</div>
										<span className="text-sm font-bold">
											{stats.breakdown.mining.toLocaleString()}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<div className="h-3 w-3 rounded-full bg-purple-500" />
											<span className="text-sm font-medium">Manual</span>
										</div>
										<span className="text-sm font-bold">
											{stats.breakdown.manual.toLocaleString()}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<div className="flex items-center gap-2">
											<div className="h-3 w-3 rounded-full bg-red-500" />
											<span className="text-sm font-medium">Adjustment</span>
										</div>
										<span className="text-sm font-bold">
											{stats.breakdown.adjustment.toLocaleString()}
										</span>
									</div>
								</>
							)}
						</div>
					)}
				</CardContent>
			</Card>

			<div className="grid gap-4 md:grid-cols-2">
				{/* Top Characters */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<div>
							<CardTitle>Top Characters</CardTitle>
							<CardDescription>Highest DKP earners</CardDescription>
						</div>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/admin/dkp/leaderboards">
								View All
								<ArrowRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="space-y-2">
								<Skeleton className="h-12 w-full" />
								<Skeleton className="h-12 w-full" />
								<Skeleton className="h-12 w-full" />
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Rank</TableHead>
										<TableHead>Character</TableHead>
										<TableHead className="text-right">DKP</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{stats?.topCharacters.slice(0, 5).map((char, index) => (
										<TableRow key={char.characterId}>
											<TableCell className="font-medium">#{index + 1}</TableCell>
											<TableCell>{char.characterName}</TableCell>
											<TableCell className="text-right font-mono">
												{char.amount.toLocaleString()}
											</TableCell>
										</TableRow>
									))}
									{(!stats?.topCharacters || stats.topCharacters.length === 0) && (
										<TableRow>
											<TableCell colSpan={3} className="text-center text-muted-foreground">
												No data available
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				{/* Top Corporations */}
				<Card>
					<CardHeader className="flex flex-row items-center justify-between">
						<div>
							<CardTitle>Top Corporations</CardTitle>
							<CardDescription>Most active corporations</CardDescription>
						</div>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/admin/dkp/leaderboards">
								View All
								<ArrowRight className="ml-2 h-4 w-4" />
							</Link>
						</Button>
					</CardHeader>
					<CardContent>
						{isLoading ? (
							<div className="space-y-2">
								<Skeleton className="h-12 w-full" />
								<Skeleton className="h-12 w-full" />
								<Skeleton className="h-12 w-full" />
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Rank</TableHead>
										<TableHead>Corporation</TableHead>
										<TableHead className="text-right">DKP</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{stats?.topCorporations.slice(0, 5).map((corp, index) => (
										<TableRow key={corp.corporationId}>
											<TableCell className="font-medium">#{index + 1}</TableCell>
											<TableCell>{corp.corporationName}</TableCell>
											<TableCell className="text-right font-mono">
												{corp.amount.toLocaleString()}
											</TableCell>
										</TableRow>
									))}
									{(!stats?.topCorporations || stats.topCorporations.length === 0) && (
										<TableRow>
											<TableCell colSpan={3} className="text-center text-muted-foreground">
												No data available
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Quick Actions */}
			<Card>
				<CardHeader>
					<CardTitle>Quick Actions</CardTitle>
					<CardDescription>Common DKP management tasks</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-2 md:grid-cols-3">
						<Button variant="ghost" className="justify-start" asChild>
							<Link to="/admin/dkp/awards">
								<Award className="mr-2 h-4 w-4" />
								Award DKP
							</Link>
						</Button>
						<Button variant="ghost" className="justify-start" asChild>
							<Link to="/admin/dkp/leaderboards">
								<TrendingUp className="mr-2 h-4 w-4" />
								View Leaderboards
							</Link>
						</Button>
						<Button variant="ghost" className="justify-start" asChild>
							<Link to="/admin/dkp/history">
								<Coins className="mr-2 h-4 w-4" />
								Transaction History
							</Link>
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
