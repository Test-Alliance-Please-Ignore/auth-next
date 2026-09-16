import {
	ArrowLeft,
	CheckCircle,
	Edit,
	Plus,
	Power,
	PowerOff,
	RefreshCw,
	Trash2,
	XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
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
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import { formatDateTime } from '@/lib/date-utils'

import { EntityTypeBadge, ServiceTypeBadge } from '../components'
import {
	useAddProviderService,
	useDeleteIndustryProvider,
	useIndustryProvider,
	useProviderServices,
	useRemoveProviderService,
	useSetProviderAcceptingOrders,
	useUpdateProviderServiceStatus,
} from '../hooks'
import { SERVICE_STATUS_LABELS, SERVICE_TYPE_LABELS, ServiceType } from '../types'

import type { ProviderServiceDTO, ServiceStatus } from '../types'

export default function IndustryProviderDetailPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('industry.adminProviderDetails'))
	const { providerId } = useParams<{ providerId: string }>()
	const navigate = useNavigate()

	// Queries
	const { data: provider, isLoading: isLoadingProvider, refetch } = useIndustryProvider(providerId)
	const { data: services, isLoading: isLoadingServices } = useProviderServices(providerId)

	// Mutations
	const setAcceptingOrders = useSetProviderAcceptingOrders()
	const deleteProvider = useDeleteIndustryProvider()
	const addService = useAddProviderService()
	const removeService = useRemoveProviderService()
	const updateServiceStatus = useUpdateProviderServiceStatus()

	// Dialog state
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [addServiceDialogOpen, setAddServiceDialogOpen] = useState(false)
	const [removeServiceDialogOpen, setRemoveServiceDialogOpen] = useState(false)
	const [selectedService, setSelectedService] = useState<ProviderServiceDTO | null>(null)
	const [newServiceType, setNewServiceType] = useState<ServiceType | ''>('')

	// Message state
	const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

	// Available service types (not yet added)
	const availableServiceTypes = Object.values(ServiceType).filter(
		(type) => !services?.some((s) => s.serviceType === type)
	)

	const handleToggleAcceptingOrders = async () => {
		if (!provider) return
		const confirmation = provider.acceptingOrders
			? t('industry.stopOrdersConfirm')
			: t('industry.startOrdersConfirm')
		if (!confirm(confirmation)) return

		try {
			await setAcceptingOrders.mutateAsync({
				id: provider.id,
				acceptingOrders: !provider.acceptingOrders,
			})
			setMessage({
				type: 'success',
				text: provider.acceptingOrders ? t('industry.ordersStopped') : t('industry.ordersStarted'),
			})
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : t('industry.failedToUpdateStatus'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleDeleteProvider = async () => {
		if (!provider) return
		try {
			await deleteProvider.mutateAsync(provider.id)
			void navigate('/admin/industry-providers')
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : t('industry.failedToDeleteProvider'),
			})
			setTimeout(() => setMessage(null), 5000)
			setDeleteDialogOpen(false)
		}
	}

	const handleAddService = async () => {
		if (!providerId || !newServiceType) return
		try {
			await addService.mutateAsync({
				providerId,
				serviceType: newServiceType,
			})
			setAddServiceDialogOpen(false)
			setNewServiceType('')
			setMessage({ type: 'success', text: t('industry.serviceAddedSuccessfully') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : t('industry.failedToAddService'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleRemoveService = async () => {
		if (!providerId || !selectedService) return
		try {
			await removeService.mutateAsync({
				providerId,
				serviceType: selectedService.serviceType,
			})
			setRemoveServiceDialogOpen(false)
			setSelectedService(null)
			setMessage({ type: 'success', text: t('industry.serviceRemovedSuccessfully') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : t('industry.failedToRemoveService'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	const handleUpdateServiceStatus = async (serviceType: ServiceType, newStatus: ServiceStatus) => {
		if (!providerId) return
		try {
			await updateServiceStatus.mutateAsync({
				providerId,
				serviceType,
				status: newStatus,
			})
			setMessage({ type: 'success', text: t('industry.serviceStatusUpdated') })
			setTimeout(() => setMessage(null), 3000)
		} catch (error) {
			setMessage({
				type: 'error',
				text: error instanceof Error ? error.message : t('industry.failedToUpdateStatus'),
			})
			setTimeout(() => setMessage(null), 5000)
		}
	}

	if (isLoadingProvider) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/industry-providers')}>
						<ArrowLeft className="h-4 w-4" />
						{t('industry.back')}
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">
					{t('industry.loadingProviderDetails')}
				</div>
			</div>
		)
	}

	if (!provider) {
		return (
			<div className="space-y-6">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/industry-providers')}>
						<ArrowLeft className="h-4 w-4" />
						{t('industry.back')}
					</Button>
				</div>
				<div className="text-center py-8 text-muted-foreground">
					{t('industry.providerNotFound')}
				</div>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Button variant="ghost" onClick={() => navigate('/admin/industry-providers')}>
						<ArrowLeft className="h-4 w-4" />
						{t('industry.back')}
					</Button>
					<Button variant="ghost" size="sm" onClick={() => refetch()}>
						<RefreshCw className="h-4 w-4" />
					</Button>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" asChild>
						<Link to={`/admin/industry-providers/${provider.id}/edit`}>
							<Edit className="h-4 w-4" />
							{t('industry.edit')}
						</Link>
					</Button>
					<Button variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
						<Trash2 className="h-4 w-4" />
						{t('industry.delete')}
					</Button>
				</div>
			</div>

			{/* Message */}
			{message && (
				<Card
					className={
						message.type === 'error'
							? 'border-destructive bg-destructive/10'
							: 'border-primary bg-primary/10'
					}
				>
					<CardContent className="py-3">
						<p className={message.type === 'error' ? 'text-destructive' : 'text-primary'}>
							{message.text}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Provider Info Card */}
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div>
							<CardTitle className="text-2xl">{provider.name}</CardTitle>
							{provider.description && (
								<CardDescription className="mt-2">{provider.description}</CardDescription>
							)}
						</div>
						<Button
							variant={provider.acceptingOrders ? 'ghost' : 'primary'}
							onClick={handleToggleAcceptingOrders}
							disabled={setAcceptingOrders.isPending}
						>
							{provider.acceptingOrders ? (
								<>
									<PowerOff className="h-4 w-4" />
									{t('industry.stopAcceptingOrders')}
								</>
							) : (
								<>
									<Power className="h-4 w-4" />
									{t('industry.startAcceptingOrders')}
								</>
							)}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
						<div>
							<Label className="text-muted-foreground">{t('industry.ownerType2')}</Label>
							<div className="mt-1">
								<EntityTypeBadge type={provider.ownerEntityType} />
							</div>
						</div>
						<div>
							<Label className="text-muted-foreground">{t('industry.ownerId2')}</Label>
							<p className="mt-1 font-mono text-sm">{provider.ownerEntityId}</p>
						</div>
						<div>
							<Label className="text-muted-foreground">{t('industry.status')}</Label>
							<div className="mt-1">
								{provider.acceptingOrders ? (
									<Badge variant="success">
										<CheckCircle className="mr-1 h-3 w-3" />
										{t('industry.acceptingOrders')}
									</Badge>
								) : (
									<Badge variant="destructive">
										<XCircle className="mr-1 h-3 w-3" />
										{t('industry.notAccepting')}
									</Badge>
								)}
							</div>
						</div>
						<div>
							<Label className="text-muted-foreground">{t('industry.created')}</Label>
							<p className="mt-1 text-sm">{formatDateTime(provider.createdAt)}</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Services Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>{t('industry.services')}</CardTitle>
							<CardDescription>
								{t('industry.serviceCount', { count: services?.length ?? 0 })}
							</CardDescription>
						</div>
						<Button
							onClick={() => setAddServiceDialogOpen(true)}
							disabled={availableServiceTypes.length === 0}
						>
							<Plus className="h-4 w-4" />
							{t('industry.addService')}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{isLoadingServices ? (
						<div className="space-y-3">
							{[...Array(3)].map((_, i) => (
								<Skeleton key={i} className="h-12 w-full" />
							))}
						</div>
					) : !services || services.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-muted-foreground mb-4">{t('industry.noServicesAddedYet')}</p>
							<Button onClick={() => setAddServiceDialogOpen(true)}>
								<Plus className="h-4 w-4" />
								{t('industry.addFirstService')}
							</Button>
						</div>
					) : (
						<div className="rounded-md border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t('industry.serviceType')}</TableHead>
										<TableHead>{t('industry.status')}</TableHead>
										<TableHead>{t('industry.created')}</TableHead>
										<TableHead className="text-right">{t('industry.actions')}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{services.map((service) => (
										<TableRow key={service.id}>
											<TableCell>
												<ServiceTypeBadge type={service.serviceType} />
											</TableCell>
											<TableCell>
												<Select
													value={service.status}
													onValueChange={(value) =>
														handleUpdateServiceStatus(service.serviceType, value as ServiceStatus)
													}
													options={Object.entries(SERVICE_STATUS_LABELS).map(([value, label]) => ({
														value,
														label,
													}))}
													className="w-32"
												/>
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{formatDateTime(service.createdAt)}
											</TableCell>
											<TableCell className="text-right">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => {
														setSelectedService(service)
														setRemoveServiceDialogOpen(true)
													}}
												>
													<Trash2 className="h-4 w-4 text-destructive" />
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Delete Provider Dialog */}
			<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('industry.deleteProvider')}</DialogTitle>
						<DialogDescription>
							{t('industry.deleteProviderConfirm', { name: provider.name })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDeleteDialogOpen(false)}>
							{t('industry.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDeleteProvider}
							loading={deleteProvider.isPending}
							loadingText={t('industry.deleting')}
						>
							{t('industry.deleteProvider')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Add Service Dialog */}
			<Dialog open={addServiceDialogOpen} onOpenChange={setAddServiceDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('industry.addService')}</DialogTitle>
						<DialogDescription>
							{t('industry.selectAServiceTypeToAddToThisProvider')}
						</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						<Label htmlFor="serviceType">{t('industry.serviceType')}</Label>
						<Select
							value={newServiceType}
							onValueChange={(value) => setNewServiceType(value as ServiceType)}
							inputId="serviceType"
							options={availableServiceTypes.map((type) => ({
								value: type,
								label: SERVICE_TYPE_LABELS[type],
							}))}
							placeholder={t('industry.selectAServiceType')}
							className="mt-2"
						/>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setAddServiceDialogOpen(false)}>
							{t('industry.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleAddService}
							loading={addService.isPending}
							loadingText={t('industry.adding')}
							disabled={!newServiceType}
						>
							{t('industry.addService')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Remove Service Dialog */}
			<Dialog open={removeServiceDialogOpen} onOpenChange={setRemoveServiceDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('industry.removeService')}</DialogTitle>
						<DialogDescription>
							{t('industry.removeServiceConfirm', {
								service: selectedService ? SERVICE_TYPE_LABELS[selectedService.serviceType] : '',
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="cancel"
							onClick={() => {
								setRemoveServiceDialogOpen(false)
								setSelectedService(null)
							}}
						>
							{t('industry.cancel')}
						</Button>
						<Button
							variant="destructive"
							onClick={handleRemoveService}
							loading={removeService.isPending}
							loadingText={t('industry.removing')}
						>
							{t('industry.removeService')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
