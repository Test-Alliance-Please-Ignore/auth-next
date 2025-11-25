import { Building2, CheckCircle, Factory, Settings } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import type { IndustryProviderStatistics } from '../types'

interface StatsDashboardProps {
	stats: IndustryProviderStatistics | undefined
	isLoading: boolean
}

export function StatsDashboard({ stats, isLoading }: StatsDashboardProps) {
	if (isLoading) {
		return (
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				{[...Array(4)].map((_, i) => (
					<Card key={i}>
						<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
							<Skeleton className="h-4 w-24" />
							<Skeleton className="h-4 w-4" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-8 w-16" />
						</CardContent>
					</Card>
				))}
			</div>
		)
	}

	const statCards = [
		{
			title: 'Total Providers',
			value: stats?.totalProviders ?? 0,
			icon: Factory,
			description: 'Registered service providers',
		},
		{
			title: 'Accepting Orders',
			value: stats?.totalAcceptingOrders ?? 0,
			icon: CheckCircle,
			description: 'Currently accepting new orders',
		},
		{
			title: 'Total Services',
			value: stats?.totalServices ?? 0,
			icon: Settings,
			description: 'Services offered across all providers',
		},
		{
			title: 'By Entity Type',
			value: Object.values(stats?.totalByEntityType ?? {}).filter((v) => v > 0).length,
			icon: Building2,
			description: 'Different owner types',
		},
	]

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{statCards.map((stat) => (
				<Card key={stat.title}>
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
						<stat.icon className="h-4 w-4 text-muted-foreground" />
					</CardHeader>
					<CardContent>
						<div className="text-2xl font-bold">{stat.value}</div>
						<p className="text-xs text-muted-foreground">{stat.description}</p>
					</CardContent>
				</Card>
			))}
		</div>
	)
}
