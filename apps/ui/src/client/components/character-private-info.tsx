import { Activity, Lock, MapPin, Wallet } from 'lucide-react'

import { formatDate, useAppTranslation } from '@/i18n'
import { formatISK } from '@/lib/format-utils'

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

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{/* Location */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{sensitiveDataIsLive
							? t('characterDetail.private.location')
							: t('characterDetail.private.lastKnownLocation')}
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
									? t('characterDetail.private.solarSystem')
									: t('characterDetail.private.systemId')}
							</p>
							<p
								className="text-lg font-bold"
								title={t('characterDetail.private.systemIdValue', {
									id: location.solarSystemId,
								})}
							>
								{location.solarSystemName || location.solarSystemId}
							</p>
							{location.stationId && (
								<p className="text-xs text-muted-foreground mt-1">
									{location.stationName ? (
										<span
											title={t('characterDetail.private.stationId', {
												id: location.stationId,
											})}
										>
											{t('characterDetail.private.station', { name: location.stationName })}
										</span>
									) : (
										t('characterDetail.private.station', { name: location.stationId })
									)}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t('common.notAvailable')}</p>
					)}
				</CardContent>
			</Card>

			{/* Wallet */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t('characterDetail.private.wallet')}
					</CardTitle>
					<div className="flex items-center gap-1">
						<Wallet className="h-4 w-4 text-muted-foreground" />
						<Lock className="h-3 w-3 text-muted-foreground" />
					</div>
				</CardHeader>
				<CardContent>
					{wallet ? (
						<div>
							<p className="text-xs text-muted-foreground">
								{t('characterDetail.private.balance')}
							</p>
							<p className="text-lg font-bold truncate">{formatISK(wallet.balance)}</p>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t('common.notAvailable')}</p>
					)}
				</CardContent>
			</Card>

			{/* Status */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{t('characterDetail.private.status')}
					</CardTitle>
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
								<p className="text-lg font-bold">{t('characterDetail.private.unknown')}</p>
							</div>
							<p className="text-xs text-muted-foreground mt-1">
								{t('characterDetail.private.invalidToken')}
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
									{status.online
										? t('characterDetail.private.online')
										: t('characterDetail.private.offline')}
								</p>
							</div>
							{status.lastLogin && (
								<p className="text-xs text-muted-foreground mt-1">
									{t('characterDetail.private.lastLogin', {
										date: formatDate(status.lastLogin),
									})}
								</p>
							)}
						</div>
					) : (
						<p className="text-sm text-muted-foreground">{t('common.notAvailable')}</p>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
