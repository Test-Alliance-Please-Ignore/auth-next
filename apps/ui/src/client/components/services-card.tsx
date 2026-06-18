import { ArrowRight, Mic, Server } from 'lucide-react'
import { useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ServiceDialog } from '@/components/service-dialog'
import { ServiceItemCard } from '@/components/service-item-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useApiMutation } from '@/hooks/useApiMutation'
import { serviceKeys, useUserServices } from '@/hooks/useServices'
import { apiClient } from '@/lib/api'

import type { ResetServicePasswordResponse, UserService } from '@/lib/api'
import type { MumbleConnectionInfo, MumbleAccountStatus } from '@/features/mumble/types'

interface ServicesCardProps {
	isLegacyAuthLinked: boolean
}

type MumbleAccountSummary = {
	account: MumbleAccountStatus | null
	connection: MumbleConnectionInfo
}

export function ServicesCard({ isLegacyAuthLinked }: ServicesCardProps) {
	const queryClient = useQueryClient()
	const { data: services, isLoading, error } = useUserServices(isLegacyAuthLinked)
	const {
		data: mumbleAccount,
		isLoading: isLoadingMumble,
		error: mumbleError,
	} = useQuery({
		queryKey: ['mumble', 'dashboard-account'],
		queryFn: () => apiClient.getMumbleAccount() as Promise<MumbleAccountSummary>,
		staleTime: 1000 * 30,
	})
	const [selectedService, setSelectedService] = useState<UserService | null>(null)
	const [resetResult, setResetResult] = useState<ResetServicePasswordResponse | null>(null)
	const legacyServices = services ?? []
	const hasLegacyServices = legacyServices.length > 0
	const hasMumbleAccount = mumbleAccount?.account != null

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
					<div className="space-y-4">
						<Skeleton className="h-24 rounded-lg" />
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

	return (
		<>
			<Card variant="elevated">
				<CardHeader>
					<CardTitle className="text-xl md:text-2xl">Services</CardTitle>
					<CardDescription>Manage your linked services and credentials</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{hasMumbleAccount ? (
							<MumbleServiceCard
								account={mumbleAccount!.account!}
								connection={mumbleAccount?.connection ?? null}
							/>
						) : null}
						{hasLegacyServices ? (
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
								{legacyServices.map((service) => (
									<ServiceItemCard
										key={service.id}
										service={service}
										onClick={() => setSelectedService(service)}
									/>
								))}
							</div>
		) : !hasMumbleAccount && !isLoadingMumble && !mumbleError ? (
							<div className="rounded-lg border border-border/50 bg-muted/20 p-4">
								<div className="flex items-center gap-3">
									<div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
										<Server className="h-6 w-6 text-muted-foreground" />
									</div>
									<div>
										<CardTitle className="text-lg">No services configured</CardTitle>
										<CardDescription>
											No linked services are configured for your account yet.
										</CardDescription>
									</div>
								</div>
							</div>
						) : null}
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

function MumbleServiceCard({
	account,
	connection,
}: {
	account: MumbleAccountStatus
	connection: MumbleConnectionInfo | null
}) {
	return (
		<Card variant="flat" className="border-border/50">
			<CardContent className="p-4">
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
						<Mic className="h-6 w-6 text-muted-foreground" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<h3 className="font-semibold truncate">Mumble</h3>
							<Badge
								variant="default"
								className={`text-xs ${
									account.enabled ? 'bg-green-500/20 text-green-500' : 'bg-muted text-muted-foreground'
								}`}
							>
								{account.enabled ? 'Active' : 'Disabled'}
							</Badge>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							{connection ? (
								<span>
									{account.loginName} · {connection.host}:{connection.port}
								</span>
							) : (
								account.loginName
							)}
						</p>
					</div>
					<Button asChild variant="ghost" size="sm" className="shrink-0 gap-2">
						<Link to="/mumble">
							<span>Open</span>
							<ArrowRight className="h-4 w-4" />
						</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}
