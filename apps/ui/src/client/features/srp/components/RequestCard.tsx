import { Link } from 'react-router'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'

import { formatISK, formatRelativeTime, getKillmailUrl, getRequestCharacterRole } from '../utils'
import { CharacterRoleBadge } from './CharacterRoleBadge'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { SRPRequestResponse } from '../types'

interface RequestCardProps {
	request: SRPRequestResponse
	showActions?: boolean
}

export function RequestCard({ request, showActions = true }: RequestCardProps) {
	const { t } = useAppTranslation()
	return (
		<Card className="p-4">
			<div className="space-y-3">
				<div className="flex items-start justify-between">
					<div>
						<h3 className="font-semibold">{request.shipTypeName}</h3>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<span>{request.characterName}</span>
							<CharacterRoleBadge
								role={getRequestCharacterRole(request)}
								mainCharacterName={request.mainCharacterName}
								mainCharacterId={request.mainCharacterId}
							/>
							<span>· {formatRelativeTime(request.createdAt)}</span>
						</div>
					</div>
					<div className="flex flex-col items-end gap-1">
						<RequestStatusBadge status={request.requestStatus} />
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4 text-sm">
					{request.requestStatus === 'paid' || request.requestStatus === 'payment_pending' ? (
						<div>
							<div className="text-muted-foreground">
								{request.requestStatus === 'paid'
									? t('srp.common.paidAmount')
									: t('srp.status.payment_pending')}
							</div>
							<div className="font-medium tabular-nums text-success">
								{formatISK(request.approvedAmount ?? '0')}
							</div>
						</div>
					) : (
						<>
							<div>
								<div className="text-muted-foreground">{t('srp.common.shipValue')}</div>
								<div className="font-medium tabular-nums">{formatISK(request.shipValue)}</div>
							</div>
							{request.approvedAmount && (
								<div>
									<div className="text-muted-foreground">{t('srp.status.approved')}</div>
									<div className="font-medium tabular-nums text-success">
										{formatISK(request.approvedAmount)}
									</div>
								</div>
							)}
						</>
					)}
				</div>

				{showActions && (
					<div className="flex gap-2">
						<Button variant="ghost" size="sm" asChild>
							<Link to={`/srp/request/${request.id}`}>{t('srp.common.viewDetails')}</Link>
						</Button>
						<Button variant="ghost" size="sm" asChild>
							<a href={getKillmailUrl(request.id)} target="_blank" rel="noopener noreferrer">
								{t('srp.common.zkill')}
							</a>
						</Button>
					</div>
				)}
			</div>
		</Card>
	)
}
