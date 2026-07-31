import { ArrowLeft, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useStructureModuleConfig, useUpdateStructureModuleConfig } from '@/features/structures/hooks'
import toast from '@/lib/toast'

import { hasAllStructureManagerPermission } from '@repo/groups'

export default function StructuresConfigPage() {
	usePageTitle('Structures Settings')

	const { user, isLoading: authLoading } = useAuth()
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const canManageStructures = user?.is_admin === true || hasAllStructureManagerPermission(permissions)
	const { data: config, isLoading, error } = useStructureModuleConfig()
	const updateConfig = useUpdateStructureModuleConfig()

	const [lowFuelTimeThresholdHours, setLowFuelTimeThresholdHours] = useState('')
	const [criticalFuelTimeThresholdHours, setCriticalFuelTimeThresholdHours] = useState('')
	const [lowFuelAmountThreshold, setLowFuelAmountThreshold] = useState('')
	const [criticalFuelAmountThreshold, setCriticalFuelAmountThreshold] = useState('')

	useEffect(() => {
		if (!config) return
		setLowFuelTimeThresholdHours(String(config.lowFuelTimeThresholdHours))
		setCriticalFuelTimeThresholdHours(String(config.criticalFuelTimeThresholdHours))
		setLowFuelAmountThreshold(String(config.lowFuelAmountThreshold))
		setCriticalFuelAmountThreshold(String(config.criticalFuelAmountThreshold))
	}, [config])

	const saveMutation = updateConfig
	const backAction = (
		<Button asChild variant="ghost" size="sm" className="gap-2 whitespace-nowrap">
			<Link to="/structures">
				<ArrowLeft className="h-4 w-4" />
				Back to Structures
			</Link>
		</Button>
	)

	if (!authLoading && !permissionsLoading && !canManageStructures) {
		return <Navigate to="/structures" replace />
	}

	if (isLoading) {
		return (
			<Container className="space-y-6 py-6">
				<PageHeader
					title="Structures Settings"
					description="Set the module-wide fuel thresholds used for low, critical, and alert summaries."
					action={backAction}
				/>
				<Card>
					<CardHeader>
						<CardTitle>Fuel Thresholds</CardTitle>
						<CardDescription>Loading structure settings...</CardDescription>
					</CardHeader>
					<CardContent>
						<LoadingSpinner label="Loading structure settings..." />
					</CardContent>
				</Card>
			</Container>
		)
	}

	if (error || !config) {
		return (
			<Container className="space-y-6 py-6">
				<PageHeader
					title="Structures Settings"
					description="Set the module-wide fuel thresholds used for low, critical, and alert summaries."
					action={backAction}
				/>
				<Card>
					<CardHeader>
						<CardTitle>Structures Settings</CardTitle>
						<CardDescription>
							The module-wide structure fuel configuration could not be loaded.
						</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container className="space-y-6 py-6">
			<PageHeader
				title="Structures Settings"
				description="Set the module-wide fuel thresholds used for low, critical, and alert summaries."
				action={backAction}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Fuel Thresholds</CardTitle>
					<CardDescription>
						These values apply across the module for both time-based and amount-based structures.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-4 rounded-lg border border-border/60 p-4">
							<div className="space-y-1">
								<div className="text-sm font-medium">Time-based structures</div>
								<p className="text-xs text-muted-foreground">Applies to fuel measured by remaining hours.</p>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="low-fuel-time-threshold-hours">
									Low alert threshold (hours)
								</label>
								<Input
									id="low-fuel-time-threshold-hours"
									type="number"
									min="0"
									value={lowFuelTimeThresholdHours}
									onChange={(event) => setLowFuelTimeThresholdHours(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="critical-fuel-time-threshold-hours">
									Critical alert threshold (hours)
								</label>
								<Input
									id="critical-fuel-time-threshold-hours"
									type="number"
									min="0"
									value={criticalFuelTimeThresholdHours}
									onChange={(event) => setCriticalFuelTimeThresholdHours(event.target.value)}
								/>
							</div>
						</div>
						<div className="space-y-4 rounded-lg border border-border/60 p-4">
							<div className="space-y-1">
								<div className="text-sm font-medium">Amount-based structures</div>
								<p className="text-xs text-muted-foreground">Applies to structures that track static fuel units.</p>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="low-fuel-amount-threshold">
									Low alert threshold (units)
								</label>
								<Input
									id="low-fuel-amount-threshold"
									type="number"
									min="0"
									value={lowFuelAmountThreshold}
									onChange={(event) => setLowFuelAmountThreshold(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="critical-fuel-amount-threshold">
									Critical alert threshold (units)
								</label>
								<Input
									id="critical-fuel-amount-threshold"
									type="number"
									min="0"
									value={criticalFuelAmountThreshold}
									onChange={(event) => setCriticalFuelAmountThreshold(event.target.value)}
								/>
							</div>
						</div>
					</div>

					<div className="flex items-center justify-end gap-3">
						<Button
							variant="confirm"
							showIcon={false}
							onClick={async () => {
								try {
									await saveMutation.mutateAsync({
										lowFuelTimeThresholdHours:
											lowFuelTimeThresholdHours.trim().length > 0
												? Number.parseInt(lowFuelTimeThresholdHours, 10)
												: undefined,
										criticalFuelTimeThresholdHours:
											criticalFuelTimeThresholdHours.trim().length > 0
												? Number.parseInt(criticalFuelTimeThresholdHours, 10)
												: undefined,
										lowFuelAmountThreshold:
											lowFuelAmountThreshold.trim().length > 0
												? Number.parseInt(lowFuelAmountThreshold, 10)
												: undefined,
										criticalFuelAmountThreshold:
											criticalFuelAmountThreshold.trim().length > 0
												? Number.parseInt(criticalFuelAmountThreshold, 10)
												: undefined,
									})
									toast.success('Structure fuel settings saved.')
								} catch (mutationError) {
									toast.error(
										mutationError instanceof Error ? mutationError.message : 'Failed to save settings.'
									)
								}
							}}
							loading={saveMutation.isPending}
						>
							<Save className="h-4 w-4" />
							Save Changes
						</Button>
					</div>
				</CardContent>
			</Card>
		</Container>
	)
}
