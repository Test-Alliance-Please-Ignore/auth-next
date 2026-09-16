import { Activity, Lock, MapPin, Wallet } from 'lucide-react'

import { getActiveLocale, useAppTranslation } from '@/i18n'

import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

interface CharacterPrivateInfoProps {
	sensitiveDataIsLive?: boolean
	location?: {
		solarSystemId: number
		solarSystemName?: string
		stationId?: number
		stationName?: string
		structureId?: string
	}
	wallet?: {
		balance: string
	}
	status?: {
		online: boolean
		lastLogin?: Date
		lastLogout?: Date
		loginsCount?: number
	}
}

export function CharacterPrivateInfo({
	sensitiveDataIsLive = true,
	location,
	wallet,
	status,
}: CharacterPrivateInfoProps) {
	const { t } = useAppTranslation()

	const formatISK = (value: string) => {
		const num = parseFloat(value)
		return (
			new Intl.NumberFormat(getActiveLocale(), {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(num) + ' ISK'
		)
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{/* Location */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{sensitiveDataIsLive
							? t('characterpages.location')
							: t('characterpages.lastKnownLocation')}
					</CardTitle>
					<div className="flex items-center gap-1">
						<MapPin className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{location ? (
						<div>
							<p className="text-xs text-muted-foreground">
								{location.solarSystemName
									? t('characterpages.solarSystem')
									: t('characterpages.systemId')}
							</p>
							<p
								className="text-lg font-bold"
								title={t('characterpages.systemIdValue1', { value1: location.solarSystemId })}
							>
								{location.solarSystemName || location.solarSystemId}
							</p>
							{location.stationId && (
								<p className="text-xs text-muted-foreground mt-1">
									{location.stationName ? (
										<span
											title={t('characterpages.stationIdValue1', { value1: location.stationId })}
										>
											{t('characterpages.station')}
											{location.stationName}
										</span>
									) : (
										t('characterpages.stationValue1', { value1: location.stationId })
									)}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t('characterpages.notAvailable')}</p>
					)}
				</CardContent>
			</Card>

			{/* Wallet */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">{t('characterpages.wallet')}</CardTitle>
					<div className="flex items-center gap-1">
						<Wallet className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{wallet ? (
						<div>
							<p className="text-xs text-muted-foreground">{t('characterpages.balance')}</p>
							<p className="text-lg font-bold truncate">{formatISK(wallet.balance)}</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t('characterpages.notAvailable')}</p>
					)}
				</CardContent>
			</Card>

			{/* Status */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">{t('characterpages.status')}</CardTitle>
					<div className="flex items-center gap-1">
						<Activity className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{!sensitiveDataIsLive ? (
						<div>
							<div className="flex items-center gap-2">
								<div className="h-2 w-2 rounded-full bg-gray-400" />
								<p className="text-lg font-bold">{t('characterpages.unknown')}</p>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{t('characterpages.tokenIsNoLongerValidForLiveStatusUpdates')}
							</p>
						</div>
					) : status ? (
						<div>
							<div className="flex items-center gap-2">
								<div
									className={`h-2 w-2 rounded-full ${
										status.online ? 'bg-green-500' : 'bg-gray-400'
									}`}
								/>
								<p className="text-lg font-bold">
									{status.online ? t('characterpages.online') : t('characterpages.offline')}
								</p>
							</div>
							{status.lastLogin && (
								<p className="text-xs text-muted-foreground mt-1">
									{t('characterpages.lastLogin')}
									{new Date(status.lastLogin).toLocaleDateString(getActiveLocale())}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t('characterpages.notAvailable')}</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
