import { Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { GhostButton } from '@/components/ui/ghost-button'
import { Label } from '@/components/ui/label'
import { NumberInput } from '@/components/ui/number-input'
import { SearchSelect } from '@/components/ui/search-select'
import { usePageTitle } from '@/hooks/usePageTitle'
import { PERMISSIONS, useUserPermissions } from '@/hooks/useUserPermissions'

import { useActiveFreightRoutes } from '../hooks'
import { formatISK, formatNumber } from '../utils'

import type { FreightRoute } from '@repo/freight'

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
	usePageTitle('Freight Calculator')
	const { data: routes, isLoading, error } = useActiveFreightRoutes()
	const { hasPermission } = useUserPermissions()
	const canManage = hasPermission(PERMISSIONS.FREIGHT_MANAGER)

	const [selectedRouteId, setSelectedRouteId] = useState<string>('')
	const [volume, setVolume] = useState('')
	const [collateral, setCollateral] = useState('')
	const [routeQuery, setRouteQuery] = useState('')

	const routeOptions = useMemo(
		() =>
			(routes ?? []).map((route) => ({
				id: route.id,
				value: route.id,
				label: `${route.pickupName} → ${route.destinationName}`,
				description: `${formatISK(route.iskPerVolumeUnit)}/m³`,
			})),
		[routes]
	)

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
		<div className="mb-section md:mb-10 flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 className="text-3xl font-bold gradient-text">Freight Calculator</h1>
				<p className="text-muted-foreground mt-1">
					Calculate your shipping cost and get the contract details to enter in-game
				</p>
			</div>
			{canManage ? (
				<GhostButton asChild>
					<Link to="/freight/manage">Manage Routes</Link>
				</GhostButton>
			) : null}
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
					<p className="text-sm text-red-500">
						Failed to load freight routes. Please try again later.
					</p>
				</div>
			</Container>
		)
	}

	if (!routes || routes.length === 0) {
		return (
			<Container size="narrow">
				{pageHeader}
				<div className="rounded-lg border border-dashed p-12 text-center">
					<p className="text-muted-foreground">No freight routes are currently available.</p>
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
						<CardTitle>Calculator</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Route Selection */}
						<div className="space-y-2">
							<Label htmlFor="route">Route</Label>
							<SearchSelect
								inputId="route"
								value={routeQuery}
								onValueChange={setRouteQuery}
								options={routeOptions}
								onSelect={(option) => {
									setSelectedRouteId(option.id)
									setRouteQuery('')
								}}
								filterMode="local"
								mode="dropdown"
								minQueryLength={0}
								placeholder={
									selectedRoute
										? `${selectedRoute.pickupName} → ${selectedRoute.destinationName} — ${formatISK(selectedRoute.iskPerVolumeUnit)}/m³`
										: 'Select a route...'
								}
								emptyText="No routes found"
							/>
							{selectedRoute?.notes && (
								<p className="text-sm text-muted-foreground">{selectedRoute.notes}</p>
							)}
						</div>

						{/* Volume */}
						<div className="space-y-2">
							<Label htmlFor="volume">Volume (m³)</Label>
							<NumberInput
								id="volume"
								min={0}
								placeholder="Enter cargo volume..."
								value={volume}
								onChange={handleVolumeChange}
							/>
							{volumeExceedsMax && (
								<p className="text-sm text-destructive">
									Exceeds max volume of {formatNumber(selectedRoute!.maxVolume!)} m³ per contract
								</p>
							)}
						</div>

						{/* Collateral */}
						<div className="space-y-2">
							<Label htmlFor="collateral">Collateral (ISK)</Label>
							<NumberInput
								id="collateral"
								min={0}
								placeholder="Enter total cargo value..."
								value={collateral}
								onChange={handleCollateralChange}
							/>
							{selectedRoute?.collateralFeeRate && (
								<p className="text-sm text-muted-foreground">
									Collateral fee: {(parseFloat(selectedRoute.collateralFeeRate) * 100).toFixed(2)}%
									of collateral value
								</p>
							)}
							{selectedRoute?.minReward && (
								<p className="text-sm text-muted-foreground">
									Minimum reward: {formatISK(parseFloat(selectedRoute.minReward))}
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
								<CardTitle>Total Reward</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-bold tabular-nums">{formatISK(reward.total)}</p>
								{reward.minApplied && (
									<p className="text-sm text-muted-foreground mt-1">
										Minimum reward of {formatISK(parseFloat(selectedRoute.minReward!))} applied
									</p>
								)}
								{!reward.minApplied &&
									selectedRoute.collateralFeeRate &&
									reward.collateralFee > 0 && (
										<p className="text-sm text-muted-foreground mt-1">
											{formatISK(reward.shippingCost)} shipping + {formatISK(reward.collateralFee)}{' '}
											collateral fee
										</p>
									)}
							</CardContent>
						</Card>

						{/* Contract Details */}
						<Card>
							<CardHeader>
								<CardTitle>Contract Details</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-sm text-muted-foreground mb-4">
									Enter these values when creating your courier contract in-game.
								</p>
								<dl className="space-y-3">
									<ContractRow label="Contract Type" value="Courier" />
									<ContractRow label="Availability" value="My Alliance" />
									<ContractRow label="Ship To" value={selectedRoute.destinationName} />
									<ContractRow
										label="Reward"
										value={`${formatISK(reward.total)}`}
										copyValue={Math.round(reward.total).toString()}
									/>
									<ContractRow
										label="Collateral"
										value={collateralNum > 0 ? formatISK(collateralNum) : 'None'}
										copyValue={collateralNum > 0 ? Math.round(collateralNum).toString() : undefined}
									/>
									<ContractRow
										label="Expiration"
										value={selectedRoute.expiration ? `${selectedRoute.expiration} Days` : '7 Days'}
									/>
									<ContractRow
										label="Days to Complete"
										value={
											selectedRoute.daysToComplete
												? `${selectedRoute.daysToComplete} Days`
												: '3 Days'
										}
									/>
								</dl>

								{selectedRoute.notes && (
									<div className="mt-4 rounded-md border border-border p-3">
										<p className="text-sm font-medium mb-1">Route Notes</p>
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
	label,
	value,
	copyValue,
}: {
	label: string
	value: React.ReactNode
	copyValue?: string
}) {
	const [copied, setCopied] = useState(false)

	const handleCopy = async () => {
		if (!copyValue) return
		await navigator.clipboard.writeText(copyValue)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
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
						title={copied ? 'Copied!' : `Copy ${label}`}
					>
						{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
					</Button>
				)}
			</dd>
		</div>
	)
}
