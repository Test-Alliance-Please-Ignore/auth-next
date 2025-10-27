import { Calendar, DollarSign, FileText, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ISKAmount } from '@/components/bills/isk-amount'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useBillStatistics, useScheduleStatistics } from '@/hooks/useBills'
import { usePageTitle } from '@/hooks/usePageTitle'

export default function BillsDashboardPage() {
	usePageTitle('Admin - Bills Dashboard')

	const { data: billStats, isLoading: billStatsLoading } = useBillStatistics()
	const { data: scheduleStats, isLoading: scheduleStatsLoading } = useScheduleStatistics()

	const isLoading = billStatsLoading || scheduleStatsLoading

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Bills Dashboard</h1>
					<p className="text-muted-foreground mt-1">
						Overview of bills, templates, and schedules
					</p>
				</div>
				<Button asChild>
					<Link to="/admin/bills">View All Bills</Link>
				</Button>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-12">
					<div className="text-muted-foreground">Loading statistics...</div>
				</div>
			) : (
				<>
					{/* Bill Statistics */}
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Bills</CardTitle>
								<FileText className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{billStats?.totalBills || 0}</div>
								<p className="text-xs text-muted-foreground">All bills in the system</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Paid Bills</CardTitle>
								<TrendingUp className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{billStats?.billsByStatus?.paid || 0}
								</div>
								<p className="text-xs text-muted-foreground">Successfully paid</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Overdue Bills</CardTitle>
								<FileText className="h-4 w-4 text-destructive" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold text-destructive">
									{billStats?.billsByStatus?.overdue || 0}
								</div>
								<p className="text-xs text-muted-foreground">Bills past due date</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Amount</CardTitle>
								<DollarSign className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{billStats?.totalAmount ? (
										<ISKAmount amount={billStats.totalAmount} />
									) : (
										'0 ISK'
									)}
								</div>
								<p className="text-xs text-muted-foreground">All bills combined</p>
							</CardContent>
						</Card>
					</div>

					{/* Schedule Statistics */}
					<div className="grid gap-4 md:grid-cols-3">
						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Active Schedules</CardTitle>
								<Calendar className="h-4 w-4 text-success" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold text-success">
									{scheduleStats?.activeSchedules || 0}
								</div>
								<p className="text-xs text-muted-foreground">
									Currently running schedules
								</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Paused Schedules</CardTitle>
								<Calendar className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{scheduleStats?.pausedSchedules || 0}</div>
								<p className="text-xs text-muted-foreground">Temporarily disabled</p>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
								<CardTitle className="text-sm font-medium">Total Schedules</CardTitle>
								<Calendar className="h-4 w-4 text-muted-foreground" />
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">{scheduleStats?.totalSchedules || 0}</div>
								<p className="text-xs text-muted-foreground">All recurring bills</p>
							</CardContent>
						</Card>
					</div>

					{/* Quick Actions */}
					<Card>
						<CardHeader>
							<CardTitle>Quick Actions</CardTitle>
							<CardDescription>Common tasks and shortcuts</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-4">
							<Button asChild>
								<Link to="/admin/bills/new">Create New Bill</Link>
							</Button>
							<Button variant="outline" asChild>
								<Link to="/admin/bills/templates">Manage Templates</Link>
							</Button>
							<Button variant="outline" asChild>
								<Link to="/admin/bills/schedules">Manage Schedules</Link>
							</Button>
							<Button variant="outline" asChild>
								<Link to="/admin/bills?status=overdue">View Overdue Bills</Link>
							</Button>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	)
}
