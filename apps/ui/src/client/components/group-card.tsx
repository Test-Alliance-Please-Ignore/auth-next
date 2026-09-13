import { Check, Copy, UserCog, Users } from 'lucide-react'
import { useState } from 'react'
import { Trans } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatNumber, useAppTranslation } from '@/i18n'

import { JoinModeBadge } from './join-mode-badge'
import { VisibilityBadge } from './visibility-badge'

import type { GroupWithDetails } from '@/lib/api'

interface GroupCardProps {
	group: GroupWithDetails
}

export function GroupCard({ group }: GroupCardProps) {
	const { t } = useAppTranslation()
	const [copiedId, setCopiedId] = useState(false)

	const handleCopyId = async () => {
		try {
			await navigator.clipboard.writeText(group.id)
			setCopiedId(true)
			setTimeout(() => setCopiedId(false), 2000)
		} catch (error) {
			console.error('Failed to copy group ID:', error)
		}
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<CardTitle className="text-2xl gradient-text">{group.name}</CardTitle>
						<CardDescription>{group.category.name}</CardDescription>
					</div>
					<div className="flex gap-2 items-center">
						<VisibilityBadge visibility={group.visibility} />
						<JoinModeBadge joinMode={group.joinMode} />
						{group.mumbleSyncEnabled ? (
							<Badge variant="secondary">
								{group.mumbleTicker ? `Mumble ${group.mumbleTicker}` : 'Mumble'}
							</Badge>
						) : null}
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
							onClick={handleCopyId}
							title={copiedId ? t('groups.card.copied') : t('groups.card.copyId')}
							aria-label={copiedId ? t('groups.card.copied') : t('groups.card.copyId')}
						>
							{copiedId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}

				<div className="flex gap-6 text-sm">
					<div className="flex items-center gap-2">
						<Users className="h-4 w-4 text-muted-foreground" />
						<span>
							<Trans
								i18nKey="groups.card.members"
								count={group.memberCount || 0}
								values={{ formattedCount: formatNumber(group.memberCount || 0) }}
								components={{ strong: <span className="font-medium" /> }}
							/>
						</span>
					</div>
					<div className="flex items-center gap-2">
						<UserCog className="h-4 w-4 text-muted-foreground" />
						<span className="text-muted-foreground">
							{t('groups.card.owner', { name: group.ownerName || group.ownerId })}
						</span>
					</div>
				</div>

				{group.visibility === 'system' && (
					<div className="rounded-md border border-destructive bg-destructive/10 p-3">
						<p className="text-sm text-destructive font-medium">{t('groups.card.systemTitle')}</p>
						<p className="text-xs text-destructive/80 mt-1">{t('groups.card.systemDescription')}</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
