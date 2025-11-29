import { Server } from 'lucide-react'
import { useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { ServiceDialog } from '@/components/service-dialog'
import { ServiceItemCard } from '@/components/service-item-card'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useApiMutation } from '@/hooks/useApiMutation'
import { serviceKeys, useUserServices } from '@/hooks/useServices'
import { apiClient } from '@/lib/api'

import type { ResetServicePasswordResponse, UserService } from '@/lib/api'

interface ServicesCardProps {
	isLegacyAuthLinked: boolean
}

export function ServicesCard({ isLegacyAuthLinked }: ServicesCardProps) {
	const queryClient = useQueryClient()
	const { data: services, isLoading, error } = useUserServices(isLegacyAuthLinked)
	const [selectedService, setSelectedService] = useState<UserService | null>(null)
	const [resetResult, setResetResult] = useState<ResetServicePasswordResponse | null>(null)

	const resetMutation = useApiMutation({
		mutationFn: (slug: string) => apiClient.resetServicePassword(slug),
		showSuccessToast: false, // We handle success in the dialog
		onSuccess: (data) => {
			setResetResult(data)
			void queryClient.invalidateQueries({ queryKey: serviceKeys.user() })
		},
	})

	const handleReset = async (slug: string) => {
		setResetResult(null)
		await resetMutation.mutateAsync(slug)
	}

	const handleCloseDialog = (open: boolean) => {
		if (!open) {
			setSelectedService(null)
			setResetResult(null)
			resetMutation.reset()
		}
	}

	if (isLoading) {
		return (
			<Card variant="elevated">
				<CardHeader>
					<CardTitle className="text-xl md:text-2xl">Services</CardTitle>
					<CardDescription>Manage your linked services</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{[1, 2, 3].map((i) => (
							<Skeleton key={i} className="h-20 rounded-lg" />
						))}
					</div>
				</CardContent>
			</Card>
		)
	}

	if (error) {
		return (
			<Card variant="elevated">
				<CardHeader>
					<CardTitle className="text-xl md:text-2xl">Services</CardTitle>
					<CardDescription>Manage your linked services</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground">Failed to load services. Please try again later.</p>
				</CardContent>
			</Card>
		)
	}

	if (!services || services.length === 0) {
		return (
			<Card variant="elevated">
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
							<Server className="h-6 w-6 text-muted-foreground" />
						</div>
						<div>
							<CardTitle className="text-xl md:text-2xl">Services</CardTitle>
							<CardDescription>No services configured for your account</CardDescription>
						</div>
					</div>
				</CardHeader>
			</Card>
		)
	}

	return (
		<>
			<Card variant="elevated">
				<CardHeader>
					<CardTitle className="text-xl md:text-2xl">Services</CardTitle>
					<CardDescription>Manage your linked services and credentials</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
						{services.map((service) => (
							<ServiceItemCard
								key={service.id}
								service={service}
								onClick={() => setSelectedService(service)}
							/>
						))}
					</div>
				</CardContent>
			</Card>

			<ServiceDialog
				service={selectedService}
				open={!!selectedService}
				onOpenChange={handleCloseDialog}
				onReset={handleReset}
				isResetting={resetMutation.isPending}
				resetResult={resetResult}
				resetError={resetMutation.error}
			/>
		</>
	)
}
