import { ArrowLeft, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { hasAllStructureManagerPermission } from '@repo/groups'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import {
	useStructureModuleConfig,
	useUpdateStructureModuleConfig,
} from '@/features/structures/hooks'
import { useAuth } from '@/hooks/useAuth'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

export default function StructuresConfigPage() {
	const { t } = useAppTranslation()

	usePageTitle(t('structures.structuresSettings'))

	const { user, isLoading: authLoading } = useAuth()
	const { permissions, isLoading: permissionsLoading } = useUserPermissions()
	const canManageStructures =
		user?.is_admin === true || hasAllStructureManagerPermission(permissions)
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
				{t('structures.backToStructures')}
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
					title={t('structures.structuresSettings')}
					description={t('structures.setTheModuleWideFuelThresholdsUsedForLowCritical')}
					action={backAction}
				/>
				<Card>
					<CardHeader>
						<CardTitle>{t('structures.fuelThresholds')}</CardTitle>
						<CardDescription>{t('structures.loadingStructureSettings')}</CardDescription>
					</CardHeader>
					<CardContent>
						<LoadingSpinner label={t('structures.loadingStructureSettings')} />
					</CardContent>
				</Card>
			</Container>
		)
	}

	if (error || !config) {
		return (
			<Container className="space-y-6 py-6">
				<PageHeader
					title={t('structures.structuresSettings')}
					description={t('structures.setTheModuleWideFuelThresholdsUsedForLowCritical')}
					action={backAction}
				/>
				<Card>
					<CardHeader>
						<CardTitle>{t('structures.structuresSettings')}</CardTitle>
						<CardDescription>
							{t('structures.theModuleWideStructureFuelConfigurationCouldNotBeLoaded')}
						</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container className="space-y-6 py-6">
			<PageHeader
				title={t('structures.structuresSettings')}
				description={t('structures.setTheModuleWideFuelThresholdsUsedForLowCritical')}
				action={backAction}
			/>

			<Card>
				<CardHeader>
					<CardTitle>{t('structures.fuelThresholds')}</CardTitle>
					<CardDescription>
						{t('structures.theseValuesApplyAcrossTheModuleForBothTimeBased')}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-4 rounded-lg border border-border/60 p-4">
							<div className="space-y-1">
								<div className="text-sm font-medium">{t('structures.timeBasedStructures')}</div>
								<p className="text-xs text-muted-foreground">
									{t('structures.appliesToFuelMeasuredByRemainingHours')}
								</p>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="low-fuel-time-threshold-hours">
									{t('structures.lowAlertThresholdHours')}
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
									{t('structures.criticalAlertThresholdHours')}
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
								<div className="text-sm font-medium">{t('structures.amountBasedStructures')}</div>
								<p className="text-xs text-muted-foreground">
									{t('structures.appliesToStructuresThatTrackStaticFuelUnits')}
								</p>
							</div>
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="low-fuel-amount-threshold">
									{t('structures.lowAlertThresholdUnits')}
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
									{t('structures.criticalAlertThresholdUnits')}
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
									toast.success(t('structures.structureFuelSettingsSaved'))
								} catch (mutationError) {
									toast.error(
										mutationError instanceof Error
											? mutationError.message
											: t('structures.failedToSaveSettings')
									)
								}
							}}
							loading={saveMutation.isPending}
						>
							<Save className="h-4 w-4" />
							{t('structures.saveChanges')}
						</Button>
					</div>
				</CardContent>
			</Card>
		</Container>
	)
}
