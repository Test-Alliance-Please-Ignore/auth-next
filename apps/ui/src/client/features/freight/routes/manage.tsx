import { Edit, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { SearchSelect } from '@/components/ui/search-select'
import { Skeleton } from '@/components/ui/skeleton'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useActivateFreightRoute,
	useDeactivateFreightRoute,
	useDeleteFreightRoute,
	useFreightRoutes,
} from '@/hooks/useFreightRoutes'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { usePageTitle } from '@/hooks/usePageTitle'

import type { FreightRouteStatus } from '@repo/freight'

export default function FreightManagePage() {
	usePageTitle('Manage Freight Routes')

	const [statusFilter, setStatusFilter] = useState<FreightRouteStatus | 'all'>('all')

	const filters = statusFilter !== 'all' ? { status: statusFilter } : undefined
	const { data: routes, isLoading } = useFreightRoutes(filters)
	const activateRoute = useActivateFreightRoute()
	const deactivateRoute = useDeactivateFreightRoute()
	const deleteRoute = useDeleteFreightRoute()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const handleActivate = (routeId: string) => {
		requestConfirmation({
			title: 'Activate Route',
			description: 'Are you sure you want to activate this route?',
			confirmLabel: 'Activate',
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await activateRoute.mutateAsync(routeId)
				} catch (error) {
					console.error('Failed to activate route:', error)
					throw error
				}
			},
		})
	}

	const handleDeactivate = (routeId: string) => {
		requestConfirmation({
			title: 'Deactivate Route',
			description: 'Are you sure you want to deactivate this route?',
			confirmLabel: 'Deactivate',
			intent: 'secondary',
			onConfirm: async () => {
				try {
					await deactivateRoute.mutateAsync(routeId)
				} catch (error) {
					console.error('Failed to deactivate route:', error)
					throw error
				}
			},
		})
	}

	const handleDelete = (routeId: string) => {
		requestConfirmation({
			title: 'Delete Route',
			description: 'Are you sure you want to permanently delete this route? This cannot be undone.',
			confirmLabel: 'Delete Route',
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteRoute.mutateAsync(routeId)
				} catch (error) {
					console.error('Failed to delete route:', error)
					throw error
				}
			},
		})
	}

	const formatISK = (amount: string) => {
		const num = parseFloat(amount)
		return new Intl.NumberFormat('en-US').format(num)
	}

	return (
		<div className="space-y-6">
			{/* Page Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Freight Routes</h1>
					<p className="text-muted-foreground mt-1">Manage official freight routes and pricing</p>
				</div>
				<Button asChild>
					<Link to="/freight/manage/new">
						<Plus className="mr-2 h-4 w-4" />
						Create Route
					</Link>
				</Button>
			</div>

			{/* Filters */}
			<Card>
				<CardHeader>
					<CardTitle>Filters</CardTitle>
					<CardDescription>Filter routes by status</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-4">
						<div className="w-full md:w-64 space-y-2">
							<Label htmlFor="status">Status</Label>
							<SearchSelect
								inputId="status"
								value={statusFilter === 'all' ? 'All Statuses' : statusFilter === 'active' ? 'Active' : 'Inactive'}
								onValueChange={() => {}}
								options={[
									{ id: 'all', value: 'all', label: 'All Statuses' },
									{ id: 'active', value: 'active', label: 'Active' },
									{ id: 'inactive', value: 'inactive', label: 'Inactive' },
								]}
								onSelect={(option) => setStatusFilter(option.value as FreightRouteStatus | 'all')}
								filterMode="local"
								mode="dropdown"
								placeholder="All statuses"
							/>
						</div>
						{statusFilter !== 'all' && (
							<Button variant="outline" onClick={() => setStatusFilter('all')} className="mt-8">
								Clear Filter
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Routes Table */}
			<Card>
				<CardHeader>
					<CardTitle>Routes</CardTitle>
					<CardDescription>
						{routes?.length || 0} route{routes?.length !== 1 ? 's' : ''}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-3">
							{[...Array(5)].map((_, i) => (
								<Skeleton key={i} className="h-16 w-full" />
							))}
						</div>
					) : !routes || routes.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-muted-foreground mb-4">No freight routes found</p>
							<Button asChild>
								<Link to="/freight/manage/new">
									<Plus className="mr-2 h-4 w-4" />
									Create Your First Route
								</Link>
							</Button>
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Pickup</TableHead>
										<TableHead>Destination</TableHead>
										<TableHead className="text-right">Price (ISK/m³)</TableHead>
										<TableHead className="text-right">Max Volume</TableHead>
										<TableHead>Status</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{routes.map((route) => (
										<TableRow key={route.id}>
											<TableCell>
												{route.pickupName || 'Unnamed'}
											</TableCell>
											<TableCell>
												{route.destinationName || 'Unnamed'}
											</TableCell>
											<TableCell className="text-right font-mono">
												{formatISK(route.iskPerVolumeUnit)}
											</TableCell>
											<TableCell className="text-right">
												{route.maxVolume ? (
													`${formatISK(route.maxVolume)} m³`
												) : (
													<span className="text-muted-foreground">Unlimited</span>
												)}
											</TableCell>
											<TableCell>
												<Badge variant={route.status === 'active' ? 'default' : 'secondary'}>
													{route.status}
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													<Button variant="outline" size="sm" asChild>
														<Link to={`/freight/manage/${route.id}/edit`}>
															<Edit className="h-4 w-4" />
														</Link>
													</Button>
													{route.status === 'active' ? (
														<Button
															variant="outline"
															size="sm"
															onClick={() => handleDeactivate(route.id)}
															disabled={deactivateRoute.isPending}
														>
															<PowerOff className="h-4 w-4" />
														</Button>
													) : (
														<Button
															variant="outline"
															size="sm"
															onClick={() => handleActivate(route.id)}
															disabled={activateRoute.isPending}
														>
															<Power className="h-4 w-4" />
														</Button>
													)}
													<Button
														variant="outline"
														size="sm"
														onClick={() => handleDelete(route.id)}
														disabled={deleteRoute.isPending}
														className="text-destructive hover:text-destructive"
													>
														<Trash2 className="h-4 w-4" />
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

			{confirmationDialog}
		</div>
	)
}
