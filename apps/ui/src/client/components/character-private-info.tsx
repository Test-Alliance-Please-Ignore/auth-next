import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { MapPin, Wallet, Package, Activity, Lock } from 'lucide-react'

interface CharacterPrivateInfoProps {
	location?: {
		solarSystemId: number
		stationId?: number
		structureId?: string
	}
	wallet?: {
		balance: string
	}
	assets?: {
		totalValue?: string
		assetCount?: number
		lastUpdated?: Date
	}
	status?: {
		online: boolean
		lastLogin?: Date
		lastLogout?: Date
		loginsCount?: number
	}
}

export function CharacterPrivateInfo({ location, wallet, assets, status }: CharacterPrivateInfoProps) {
	const formatISK = (value: string) => {
		const num = parseFloat(value)
		return new Intl.NumberFormat('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(num) + ' ISK'
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{/* Location */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Location</CardTitle>
					<div className="flex items-center gap-1">
						<MapPin className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{location ? (
						<div>
							<p className="text-xs text-muted-foreground">System ID</p>
							<p className="text-lg font-bold">{location.solarSystemId}</p>
							{location.stationId && (
								<p className="text-xs text-muted-foreground mt-1">
									Station: {location.stationId}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Not available</p>
					)}
				</CardContent>
			</Card>

			{/* Wallet */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Wallet</CardTitle>
					<div className="flex items-center gap-1">
						<Wallet className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{wallet ? (
						<div>
							<p className="text-xs text-muted-foreground">Balance</p>
							<p className="text-lg font-bold truncate">{formatISK(wallet.balance)}</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Not available</p>
					)}
				</CardContent>
			</Card>

			{/* Assets */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Assets</CardTitle>
					<div className="flex items-center gap-1">
						<Package className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{assets ? (
						<div>
							<p className="text-xs text-muted-foreground">Items</p>
							<p className="text-lg font-bold">{assets.assetCount || 0}</p>
							{assets.totalValue && (
								<p className="text-xs text-muted-foreground mt-1">
									Value: {formatISK(assets.totalValue)}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Not available</p>
					)}
				</CardContent>
			</Card>

			{/* Status */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Status</CardTitle>
					<div className="flex items-center gap-1">
						<Activity className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{status ? (
						<div>
							<div className="flex items-center gap-2">
								<div
									className={`h-2 w-2 rounded-full ${
										status.online ? 'bg-green-500' : 'bg-gray-400'
									}`}
								/>
								<p className="text-lg font-bold">{status.online ? 'Online' : 'Offline'}</p>
							</div>
							{status.lastLogin && (
								<p className="text-xs text-muted-foreground mt-1">
									Last login: {new Date(status.lastLogin).toLocaleDateString()}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">Not available</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}