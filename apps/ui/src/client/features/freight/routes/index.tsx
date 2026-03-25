import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/ui/loading'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { usePageTitle } from '@/hooks/usePageTitle'
import { PERMISSIONS, useUserPermissions } from '@/hooks/useUserPermissions'

import { useActiveFreightRoutes } from '../hooks'
import { formatIsk, formatInputNumber, formatNumber, parseFormattedNumber } from '../utils'

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

	const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = parseFormattedNumber(e.target.value)
		if (raw === '' || /^\d+$/.test(raw)) setVolume(raw)
	}

	const handleCollateralChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const raw = parseFormattedNumber(e.target.value)
		if (raw === '' || /^\d+$/.test(raw)) setCollateral(raw)
	}

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

	if (isLoading) {
		return (
			<Container>
				<PageHeader title="Freight Calculator" description="Calculate shipping costs" />
				<Section>
					<LoadingSpinner />
				</Section>
			</Container>
		)
	}

	if (error) {
		return (
			<Container>
				<PageHeader title="Freight Calculator" description="Calculate shipping costs" />
				<Section>
					<div className="text-center text-destructive">
						Failed to load freight routes. Please try again later.
					</div>
				</Section>
			</Container>
		)
	}

	if (!routes || routes.length === 0) {
		return (
			<Container size="narrow">
				<PageHeader
					title="Freight Calculator"
					description="Calculate your shipping cost and get the contract details to enter in-game"
				/>
				<Section>
					<div className="text-center text-muted-foreground py-8">
						No freight routes are currently available.
					</div>
				</Section>
			</Container>
		)
	}

	return (
		<Container size="narrow">
			<PageHeader
				title="Freight Calculator"
				description="Calculate your shipping cost and get the contract details to enter in-game"
				action={
					canManage ? (
						<Button asChild variant="outline">
							<Link to="/freight/manage">Manage Routes</Link>
						</Button>
					) : undefined
				}
			/>

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
							<Select value={selectedRouteId} onValueChange={setSelectedRouteId}>
								<SelectTrigger id="route">
									<SelectValue placeholder="Select a route..." />
								</SelectTrigger>
								<SelectContent>
									{routes.map((route) => (
										<SelectItem key={route.id} value={route.id}>
											<RouteLabel route={route} />
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{selectedRoute?.notes && (
								<p className="text-sm text-muted-foreground">
									{selectedRoute.notes}
								</p>
							)}
						</div>

						{/* Volume */}
						<div className="space-y-2">
							<Label htmlFor="volume">Volume (m³)</Label>
							<Input
								id="volume"
								type="text"
								inputMode="numeric"
								placeholder="Enter cargo volume..."
								value={volume ? formatInputNumber(volume) : ''}
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
							<Input
								id="collateral"
								type="text"
								inputMode="numeric"
								placeholder="Enter total cargo value..."
								value={collateral ? formatInputNumber(collateral) : ''}
								onChange={handleCollateralChange}
							/>
							{selectedRoute?.collateralFeeRate && (
								<p className="text-sm text-muted-foreground">
									Collateral fee: {parseFloat(selectedRoute.collateralFeeRate) * 100}% of collateral
									value
								</p>
							)}
							{selectedRoute?.minReward && (
								<p className="text-sm text-muted-foreground">
									Minimum reward: {formatIsk(parseFloat(selectedRoute.minReward))} ISK
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
								<p className="text-3xl font-bold tabular-nums">
									{formatIsk(reward.total)} ISK
								</p>
								{reward.minApplied && (
									<p className="text-sm text-muted-foreground mt-1">
										Minimum reward of {formatIsk(parseFloat(selectedRoute.minReward!))} ISK applied
									</p>
								)}
								{!reward.minApplied && selectedRoute.collateralFeeRate && reward.collateralFee > 0 && (
									<p className="text-sm text-muted-foreground mt-1">
										{formatIsk(reward.shippingCost)} shipping +{' '}
										{formatIsk(reward.collateralFee)} collateral fee
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
									<ContractRow
										label="Ship To"
										value={selectedRoute.destinationName}
									/>
									<ContractRow
										label="Reward"
										value={`${formatIsk(reward.total)} ISK`}
									/>
									<ContractRow
										label="Collateral"
										value={
											collateralNum > 0
												? `${formatIsk(collateralNum)} ISK`
												: 'None'
										}
									/>
									<ContractRow
										label="Expiration"
										value={
											selectedRoute.expiration
												? `${selectedRoute.expiration} Days`
												: '7 Days'
										}
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

function RouteLabel({ route }: { route: FreightRoute }) {
	return (
		<span className="flex items-center gap-1.5">
			{route.pickupName}
			<span className="text-muted-foreground">→</span>
			{route.destinationName}
			<span className="text-muted-foreground">—</span>
			<span>{formatNumber(route.iskPerVolumeUnit)} ISK/m³</span>
		</span>
	)
}

function ContractRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0 last:pb-0">
			<dt className="text-sm text-muted-foreground">{label}</dt>
			<dd className="text-sm font-medium">{value}</dd>
		</div>
	)
}
