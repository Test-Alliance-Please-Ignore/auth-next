import { Check, Copy } from 'lucide-react'
import { createElement, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { Select } from '@/components/ui/select'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { FreightFeedback } from '../feedback'
import { useActiveFreightRoutes } from '../hooks'
import { formatISK, formatNumber, getNumberInputSeparators } from '../utils'

import type { ReactNode } from 'react'
import type { FreightRoute } from '@repo/freight'
import type { AppTranslationKey } from '@/i18n'

function calculateReward(route: FreightRoute, volume: number, collateral: number) {
	const rate = parseFloat(route.iskPerVolumeUnit)
	const shippingCost = volume * rate
	const feeRate = route.collateralFeeRate ? parseFloat(route.collateralFeeRate) : 0
	const collateralFee = collateral * feeRate
	const minReward = route.minReward ? parseFloat(route.minReward) : 0
	const calculatedTotal = shippingCost + collateralFee
	const total = Math.max(calculatedTotal, minReward)
	return {
		shippingCost,
		collateralFee,
		total,
		minApplied: minReward > 0 && calculatedTotal < minReward,
	}
}

export default function FreightCalculatorPage() {
	const { t, locale } = useAppTranslation()
	const numberInputSeparators = getNumberInputSeparators(locale)
	usePageTitle(t('freight.calculator.title'))
	const { data: routes, isLoading, error } = useActiveFreightRoutes()

	const [selectedRouteId, setSelectedRouteId] = useState<string>('')
	const [volume, setVolume] = useState('')
	const [collateral, setCollateral] = useState('')
	const [routeQuery, setRouteQuery] = useState('')

	const routeOptions = (routes ?? []).map((route) => ({
		value: route.id,
		label: `${route.pickupName} → ${route.destinationName}`,
		description: `${formatISK(route.iskPerVolumeUnit)}/m³`,
	}))

	// Auto-select the first route (highest priority by sortOrder)
	useEffect(() => {
		if (routes && routes.length > 0 && !selectedRouteId) {
			setSelectedRouteId(routes[0].id)
		}
	}, [routes, selectedRouteId])

	const handleVolumeChange = (val: string) => setVolume(val)
	const handleCollateralChange = (val: string) => setCollateral(val)

	const selectedRoute = useMemo(
		() => routes?.find((r) => r.id === selectedRouteId),
		[routes, selectedRouteId]
	)

	const volumeNum = parseFloat(volume) || 0
	const collateralNum = parseFloat(collateral) || 0

	const reward = useMemo(() => {
		if (!selectedRoute || volumeNum <= 0) return null
		return calculateReward(selectedRoute, volumeNum, collateralNum)
	}, [selectedRoute, volumeNum, collateralNum])

	const volumeExceedsMax =
		selectedRoute?.maxVolume && volumeNum > parseFloat(selectedRoute.maxVolume)

	const pageHeader = (
		<div className="mb-section md:mb-10">
			<h1 className="text-3xl font-bold gradient-text">{t('freight.calculator.title')}</h1>
			<p className="text-muted-foreground mt-1">{t('freight.calculator.description')}</p>
		</div>
	)

	if (isLoading) {
		return (
			<Container size="narrow">
				{pageHeader}
				<div className="space-y-4">
					{[...Array(3)].map((_, i) => (
						<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
					))}
				</div>
			</Container>
		)
	}

	if (error) {
		return (
			<Container size="narrow">
				{pageHeader}
				<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
					<p className="text-sm text-red-500">{t('freight.common.loadFailed')}</p>
				</div>
			</Container>
		)
	}

	if (!routes || routes.length === 0) {
		return (
			<Container size="narrow">
				{pageHeader}
				<div className="rounded-lg border border-dashed p-12 text-center">
					<p className="text-muted-foreground">{t('freight.calculator.empty')}</p>
				</div>
			</Container>
		)
	}

	return (
		<Container size="narrow">
			{pageHeader}

			<div className="space-y-6">
				{/* Calculator Inputs */}
				<Card>
					<CardHeader>
						<CardTitle>{t('freight.calculator.heading')}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Route Selection */}
						<div className="space-y-2">
							<Label htmlFor="route">{t('freight.common.route')}</Label>
							<Select
								inputId="route"
								value={selectedRouteId}
								onValueChange={(nextValue) => setSelectedRouteId(nextValue)}
								query={routeQuery}
								onQueryChange={setRouteQuery}
								options={routeOptions}
								searchable
								minQueryLength={0}
								placeholder={
									selectedRoute
										? `${selectedRoute.pickupName} → ${selectedRoute.destinationName} — ${formatISK(selectedRoute.iskPerVolumeUnit)}/m³`
										: t('freight.calculator.selectRoute')
								}
								emptyText={t('freight.calculator.noRoutes')}
							/>
							{selectedRoute?.notes && (
								<p className="text-sm text-muted-foreground">{selectedRoute.notes}</p>
							)}
						</div>

						{/* Volume */}
						<div className="space-y-2">
							<Label htmlFor="volume">{t('freight.common.volumeUnit')}</Label>
							<NumberInput
								{...numberInputSeparators}
								id="volume"
								min={0}
								placeholder={t('freight.calculator.volumePlaceholder')}
								value={volume}
								onChange={handleVolumeChange}
							/>
							{volumeExceedsMax && (
								<p className="text-sm text-destructive">
									{t('freight.calculator.volumeExceeded', {
										volume: formatNumber(selectedRoute!.maxVolume!),
									})}
								</p>
							)}
						</div>

						{/* Collateral */}
						<div className="space-y-2">
							<Label htmlFor="collateral">{t('freight.common.collateralIsk')}</Label>
							<NumberInput
								{...numberInputSeparators}
								id="collateral"
								min={0}
								suffix=" ISK"
								placeholder={formatISK(1000000, { showDecimals: false })}
								value={collateral}
								onChange={handleCollateralChange}
							/>
							{selectedRoute?.collateralFeeRate && (
								<p className="text-sm text-muted-foreground">
									{t('freight.calculator.collateralFee', {
										rate: formatNumber(selectedRoute.collateralFeeRate, {
											style: 'percent',
											minimumFractionDigits: 2,
											maximumFractionDigits: 2,
										}),
									})}
								</p>
							)}
							{selectedRoute?.minReward && (
								<p className="text-sm text-muted-foreground">
									{t('freight.calculator.minimum', { amount: formatISK(selectedRoute.minReward) })}
								</p>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Results */}
				{reward && selectedRoute && (
					<>
						{/* Total Price */}
						<Card>
							<CardHeader>
								<CardTitle>{t('freight.calculator.total')}</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-bold tabular-nums">{formatISK(reward.total)}</p>
								{reward.minApplied && (
									<p className="text-sm text-muted-foreground mt-1">
										{t('freight.calculator.minimumApplied', {
											amount: formatISK(selectedRoute.minReward!),
										})}
									</p>
								)}
								{!reward.minApplied &&
									selectedRoute.collateralFeeRate &&
									reward.collateralFee > 0 && (
										<p className="text-sm text-muted-foreground mt-1">
											{t('freight.calculator.breakdown', {
												shipping: formatISK(reward.shippingCost),
												fee: formatISK(reward.collateralFee),
											})}
										</p>
									)}
							</CardContent>
						</Card>

						{/* Contract Details */}
						<Card>
							<CardHeader>
								<CardTitle>{t('freight.calculator.details')}</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-sm text-muted-foreground mb-4">
									{t('freight.calculator.detailsHint')}
								</p>
								<dl className="space-y-3">
									<ContractRow
										labelKey="freight.calculator.contractType"
										value={t('freight.calculator.courier')}
									/>
									<ContractRow
										labelKey="freight.calculator.availability"
										value={t('freight.calculator.alliance')}
									/>
									<ContractRow
										labelKey="freight.calculator.shipTo"
										value={selectedRoute.destinationName}
									/>
									<ContractRow
										labelKey="freight.common.reward"
										value={`${formatISK(reward.total)}`}
										copyValue={Math.round(reward.total).toString()}
									/>
									<ContractRow
										labelKey="freight.common.collateral"
										value={collateralNum > 0 ? formatISK(collateralNum) : t('freight.common.none')}
										copyValue={collateralNum > 0 ? Math.round(collateralNum).toString() : undefined}
									/>
									<ContractRow
										labelKey="freight.common.expiration"
										value={t('duration.units.day', { count: selectedRoute.expiration || 7 })}
									/>
									<ContractRow
										labelKey="freight.common.daysToComplete"
										value={t('duration.units.day', { count: selectedRoute.daysToComplete || 3 })}
									/>
								</dl>

								{selectedRoute.notes && (
									<div className="mt-4 rounded-md border border-border p-3">
										<p className="text-sm font-medium mb-1">{t('freight.calculator.notes')}</p>
										<p className="text-sm text-muted-foreground">{selectedRoute.notes}</p>
									</div>
								)}
							</CardContent>
						</Card>
					</>
				)}
			</div>
		</Container>
	)
}

function ContractRow({
	labelKey,
	value,
	copyValue,
}: {
	labelKey: AppTranslationKey
	value: ReactNode
	copyValue?: string
}) {
	const { t } = useAppTranslation()
	const label = t(labelKey)
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		if (!copyValue) return
		try {
			await navigator.clipboard.writeText(copyValue)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error(
				createElement(FreightFeedback, {
					messageKey: 'freight.calculator.copyFailed',
					labelKey,
				})
			)
		}
	}

	return (
		<div className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="text-sm font-medium flex items-center gap-1">
				{value}
				{copyValue && (
					<Button
						variant="ghost"
						size="icon"
						className="h-6 w-6 text-muted-foreground hover:text-foreground"
						onClick={handleCopy}
						title={
							copied ? t('freight.calculator.copied') : t('freight.calculator.copy', { label })
						}
						aria-label={t('freight.calculator.copy', { label })}
					>
						{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					</Button>
				)}
			</dd>
		</div>
	)
}
