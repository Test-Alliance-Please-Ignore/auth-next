import { Edit, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import {
	useActivateFreightRoute,
	useDeactivateFreightRoute,
	useDeleteFreightRoute,
	useFreightRoutes,
} from '@/hooks/useFreightRoutes'
import { usePageTitle } from '@/hooks/usePageTitle'

import { formatISK, formatNumber } from '../utils'

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

	return (
		<Container size="wide">
			<div className="mb-section md:mb-10 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">Freight Routes</h1>
					<p className="text-muted-foreground mt-1">Manage official freight routes and pricing</p>
				</div>
				<div className="flex gap-2">
					<Button variant="primary" asChild>
						<Link to="/freight/manage/new">
							<Plus className="mr-2 h-4 w-4" />
							Create Route
						</Link>
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-end justify-between">
						<div className="w-64 space-y-2">
							<Label htmlFor="status">Status</Label>
							<Select
								inputId="status"
								value={statusFilter}
								onValueChange={(nextValue) =>
									setStatusFilter(nextValue as FreightRouteStatus | 'all')
								}
								options={[
									{ value: 'all', label: 'All Statuses' },
									{ value: 'active', label: 'Active' },
									{ value: 'inactive', label: 'Inactive' },
								]}
								placeholder={
									statusFilter === 'all'
										? 'All Statuses'
										: statusFilter === 'active'
											? 'Active'
											: 'Inactive'
								}
							/>
						</div>
						<div className="flex items-center gap-3">
							{statusFilter !== 'all' && (
								<Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
									Clear Filter
								</Button>
							)}
							{!isLoading && routes && (
								<span className="text-sm text-muted-foreground">
									{routes.length} route{routes.length !== 1 ? 's' : ''}
								</span>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="space-y-4">
							{[...Array(5)].map((_, i) => (
								<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
							))}
						</div>
					) : !routes || routes.length === 0 ? (
						<div className="rounded-lg border border-dashed p-12 text-center">
							<p className="text-muted-foreground mb-4">No freight routes found</p>
							<Button asChild>
								<Link to="/freight/manage/new">
									<Plus className="mr-2 h-4 w-4" />
									Create Your First Route
								</Link>
							</Button>
						</div>
					) : (
						<div className="overflow-hidden rounded-md border">
							<Table>
								<TableHeader>
									<TableRow className="bg-muted/50">
										<TableHead className="font-semibold">Pickup</TableHead>
										<TableHead className="font-semibold">Destination</TableHead>
										<TableHead className="text-right font-semibold">Price (ISK/m³)</TableHead>
										<TableHead className="text-right font-semibold">Max Volume</TableHead>
										<TableHead className="font-semibold">Status</TableHead>
										<TableHead className="text-right font-semibold">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{routes.map((route) => (
										<TableRow key={route.id}>
											<TableCell>{route.pickupName || 'Unnamed'}</TableCell>
											<TableCell>{route.destinationName || 'Unnamed'}</TableCell>
											<TableCell className="text-right font-mono">
												{formatISK(route.iskPerVolumeUnit)}
											</TableCell>
											<TableCell className="text-right">
												{route.maxVolume ? (
													`${formatNumber(route.maxVolume)} m³`
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
													<Button variant="ghost" size="sm" asChild>
														<Link to={`/freight/manage/${route.id}/edit`}>
															<Edit className="h-4 w-4" />
														</Link>
													</Button>
													{route.status === 'active' ? (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleDeactivate(route.id)}
															disabled={deactivateRoute.isPending}
														>
															<PowerOff className="h-4 w-4" />
														</Button>
													) : (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleActivate(route.id)}
															disabled={activateRoute.isPending}
														>
															<Power className="h-4 w-4" />
														</Button>
													)}
													<Button
														variant="ghost"
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
		</Container>
	)
}
