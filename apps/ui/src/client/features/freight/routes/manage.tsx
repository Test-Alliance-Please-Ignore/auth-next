import { Edit, Plus, Power, PowerOff, Trash2 } from 'lucide-react'
import { createElement, useState } from 'react'
import { Link } from 'react-router'

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
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { FreightFeedback } from '../feedback'
import { formatISK, formatNumber } from '../utils'

import type { FreightRouteStatus } from '@repo/freight'

export default function FreightManagePage() {
	const { t } = useAppTranslation()
	usePageTitle(t('freight.manage.title'))

	const [statusFilter, setStatusFilter] = useState<FreightRouteStatus | 'all'>('all')

	const filters = statusFilter !== 'all' ? { status: statusFilter } : undefined
	const { data: routes, isLoading, error } = useFreightRoutes(filters)
	const activateRoute = useActivateFreightRoute()
	const deactivateRoute = useDeactivateFreightRoute()
	const deleteRoute = useDeleteFreightRoute()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	const handleActivate = (routeId: string) => {
		requestConfirmation({
			title: (t) => t('freight.manage.activateTitle'),
			description: (t) => t('freight.manage.activateDescription'),
			confirmLabel: (t) => t('freight.manage.activate'),
			intent: 'confirm',
			onConfirm: async () => {
				try {
					await activateRoute.mutateAsync(routeId)
				} catch (error) {
					console.error('Failed to activate route:', error)
					toast.error(
						createElement(FreightFeedback, { messageKey: 'freight.manage.activateFailed', error })
					)
					throw error
				}
			},
		})
	}

	const handleDeactivate = (routeId: string) => {
		requestConfirmation({
			title: (t) => t('freight.manage.deactivateTitle'),
			description: (t) => t('freight.manage.deactivateDescription'),
			confirmLabel: (t) => t('freight.manage.deactivate'),
			intent: 'secondary',
			onConfirm: async () => {
				try {
					await deactivateRoute.mutateAsync(routeId)
				} catch (error) {
					console.error('Failed to deactivate route:', error)
					toast.error(
						createElement(FreightFeedback, { messageKey: 'freight.manage.deactivateFailed', error })
					)
					throw error
				}
			},
		})
	}

	const handleDelete = (routeId: string) => {
		requestConfirmation({
			title: (t) => t('freight.manage.deleteTitle'),
			description: (t) => t('freight.manage.deleteDescription'),
			confirmLabel: (t) => t('freight.manage.deleteTitle'),
			intent: 'destructive',
			onConfirm: async () => {
				try {
					await deleteRoute.mutateAsync(routeId)
				} catch (error) {
					console.error('Failed to delete route:', error)
					toast.error(
						createElement(FreightFeedback, { messageKey: 'freight.manage.deleteFailed', error })
					)
					throw error
				}
			},
		})
	}

	return (
		<Container size="wide">
			<div className="mb-section md:mb-10 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-bold gradient-text">{t('freight.manage.heading')}</h1>
					<p className="text-muted-foreground mt-1">{t('freight.manage.description')}</p>
				</div>
				<div className="flex gap-2">
					<Button variant="primary" asChild>
						<Link to="/freight/manage/new">
							<Plus className="h-4 w-4" />
							{t('freight.common.create')}
						</Link>
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-end justify-between">
						<div className="w-64 space-y-2">
							<Label htmlFor="status">{t('freight.common.status')}</Label>
							<Select
								inputId="status"
								value={statusFilter}
								onValueChange={(nextValue) =>
									setStatusFilter(nextValue as FreightRouteStatus | 'all')
								}
								options={[
									{ value: 'all', label: t('freight.manage.allStatuses') },
									{ value: 'active', label: t('freight.common.active') },
									{ value: 'inactive', label: t('freight.common.inactive') },
								]}
								placeholder={
									statusFilter === 'all'
										? t('freight.manage.allStatuses')
										: statusFilter === 'active'
											? t('freight.common.active')
											: t('freight.common.inactive')
								}
							/>
						</div>
						<div className="flex items-center gap-3">
							{statusFilter !== 'all' && (
								<Button variant="ghost" size="sm" onClick={() => setStatusFilter('all')}>
									{t('freight.manage.clearFilter')}
								</Button>
							)}
							{!isLoading && routes && (
								<span className="text-sm text-muted-foreground">
									{t('freight.manage.count', { count: routes.length })}
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
					) : error ? (
						<p role="alert" className="text-destructive">
							{error instanceof Error && error.message
								? error.message
								: t('freight.common.loadFailed')}
						</p>
					) : !routes || routes.length === 0 ? (
						<div className="rounded-lg border border-dashed p-12 text-center">
							<p className="text-muted-foreground mb-4">{t('freight.manage.empty')}</p>
							<Button asChild>
								<Link to="/freight/manage/new">
									<Plus className="h-4 w-4" />
									{t('freight.manage.createFirst')}
								</Link>
							</Button>
						</div>
					) : (
						<div className="overflow-hidden rounded-md border">
							<Table>
								<TableHeader>
									<TableRow className="bg-muted/50">
										<TableHead className="font-semibold">{t('freight.common.pickup')}</TableHead>
										<TableHead className="font-semibold">
											{t('freight.common.destination')}
										</TableHead>
										<TableHead className="text-right font-semibold">
											{t('freight.manage.price')}
										</TableHead>
										<TableHead className="text-right font-semibold">
											{t('freight.manage.maxVolume')}
										</TableHead>
										<TableHead className="font-semibold">{t('freight.common.status')}</TableHead>
										<TableHead className="text-right font-semibold">
											{t('freight.common.actions')}
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{routes.map((route) => (
										<TableRow key={route.id}>
											<TableCell>{route.pickupName || t('freight.common.unnamed')}</TableCell>
											<TableCell>{route.destinationName || t('freight.common.unnamed')}</TableCell>
											<TableCell className="text-right font-mono">
												{formatISK(route.iskPerVolumeUnit)}
											</TableCell>
											<TableCell className="text-right">
												{route.maxVolume ? (
													`${formatNumber(route.maxVolume)} m³`
												) : (
													<span className="text-muted-foreground">
														{t('freight.common.unlimited')}
													</span>
												)}
											</TableCell>
											<TableCell>
												<Badge variant={route.status === 'active' ? 'default' : 'secondary'}>
													{t(
														route.status === 'active'
															? 'freight.common.active'
															: 'freight.common.inactive'
													)}
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													<Button variant="ghost" size="sm" asChild>
														<Link
															to={`/freight/manage/${route.id}/edit`}
															aria-label={t('freight.common.edit')}
														>
															<Edit className="h-4 w-4" />
														</Link>
													</Button>
													{route.status === 'active' ? (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleDeactivate(route.id)}
															aria-label={t('freight.manage.deactivateTitle')}
															disabled={deactivateRoute.isPending}
														>
															<PowerOff className="h-4 w-4" />
														</Button>
													) : (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleActivate(route.id)}
															aria-label={t('freight.manage.activateTitle')}
															disabled={activateRoute.isPending}
														>
															<Power className="h-4 w-4" />
														</Button>
													)}
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDelete(route.id)}
														aria-label={t('freight.manage.deleteTitle')}
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
