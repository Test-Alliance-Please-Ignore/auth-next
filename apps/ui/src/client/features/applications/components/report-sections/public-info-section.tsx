/**
 * Public Info Section - Character overview
 */

import { ExternalLink } from 'lucide-react'

import { formatSkillPoints } from '@repo/eve-types'

import { MemberAvatar } from '@/components/member-avatar'
import { Card, CardContent } from '@/components/ui/card'
import { getActiveLocale, useAppTranslation } from '@/i18n'
import { allianceLogoUrl, corporationLogoUrl } from '@/lib/eve-images'
import { formatISKShort } from '@/lib/format-utils'

import { EntityNameLink } from './entity-name-link'

interface ProcessedPublicInfo {
	characterId: string
	characterName: string
	characterDisplayHref?: string
	birthday: string
	corporationId: string
	corporationName?: string
	corporationDisplayHref?: string
	allianceId?: string
	allianceName?: string
	allianceDisplayHref?: string
	securityStatus?: string
	gender: 'male' | 'female'
	raceId: string
	raceName?: string
	bloodlineId: string
	bloodlineName?: string
	factionId?: string
	factionName?: string
	description?: string
	title?: string
	totalSp?: number
	walletBalance?: number | null
	processedAt: string
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4 py-1.5">
			<span className="text-sm text-muted-foreground">{label}</span>
			<div className="flex items-center gap-2">{children}</div>
		</div>
	)
}

function SimpleInfoRow({ label, value }: { label: string; value?: string | null }) {
	if (!value) return null
	return (
		<InfoRow label={label}>
			<span className="text-sm font-medium text-foreground">{value}</span>
		</InfoRow>
	)
}

function NumericInfoRow({
	label,
	value,
	format,
}: {
	label: string
	value?: number | null
	format: (value: number) => string
}) {
	if (value == null) return null
	return <SimpleInfoRow label={label} value={format(value)} />
}

export function PublicInfoHeader({ data }: { data: ProcessedPublicInfo }) {
	return (
		<div className="flex items-center gap-4">
			<MemberAvatar characterId={data.characterId} characterName={data.characterName} size="lg" />
			<div>
				<h3 className="text-xl font-bold text-foreground">
					<EntityNameLink entityId={data.characterId} href={data.characterDisplayHref}>
						{data.characterName}
					</EntityNameLink>
				</h3>
				{data.title && <p className="text-sm text-muted-foreground">{data.title}</p>}
			</div>
		</div>
	)
}

export function PublicInfoCard({ data }: { data: ProcessedPublicInfo }) {
	const { t } = useAppTranslation()

	const secStatus = data.securityStatus ? parseFloat(data.securityStatus).toFixed(2) : null

	return (
		<Card variant="flat">
			<CardContent className="pt-4">
				<div className="divide-y divide-border">
					<NumericInfoRow
						label={t('hrpages.skillPoints')}
						value={data.totalSp}
						format={(value) => formatSkillPoints(value)}
					/>
					<NumericInfoRow
						label={t('hrpages.walletBalance')}
						value={data.walletBalance}
						format={(value) => formatISKShort(value)}
					/>
					<SimpleInfoRow
						label={t('hrpages.birthday')}
						value={new Date(data.birthday).toLocaleDateString(getActiveLocale())}
					/>
					<SimpleInfoRow label={t('hrpages.race')} value={data.raceName} />
					<SimpleInfoRow label={t('hrpages.bloodline')} value={data.bloodlineName} />
					<SimpleInfoRow label={t('hrpages.securityStatus')} value={secStatus} />
					{data.corporationId && (
						<InfoRow label={t('hrpages.corporation')}>
							<img
								src={corporationLogoUrl(data.corporationId, 32)}
								alt=""
								className="h-5 w-5 rounded"
							/>
							<EntityNameLink entityId={data.corporationId} href={data.corporationDisplayHref}>
								<span className="text-sm font-medium text-foreground">
									{data.corporationName || data.corporationId}
								</span>
							</EntityNameLink>
						</InfoRow>
					)}
					{data.allianceId && (
						<InfoRow label={t('hrpages.alliance')}>
							<img src={allianceLogoUrl(data.allianceId, 32)} alt="" className="h-5 w-5 rounded" />
							<EntityNameLink entityId={data.allianceId} href={data.allianceDisplayHref}>
								<span className="text-sm font-medium text-foreground">{data.allianceName}</span>
							</EntityNameLink>
						</InfoRow>
					)}
					<SimpleInfoRow label={t('hrpages.faction')} value={data.factionName} />
				</div>
			</CardContent>
		</Card>
	)
}

function ExternalLinkRow({ href, label }: { href: string; label: string }) {
	return (
		<div className="py-1.5">
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
			>
				{label}
				<ExternalLink className="h-3 w-3" />
			</a>
		</div>
	)
}

export function ExternalLinksCard({ data }: { data: ProcessedPublicInfo }) {
	const { t } = useAppTranslation()

	const encodedName = encodeURIComponent(data.characterName)

	return (
		<Card variant="flat">
			<CardContent className="pt-4">
				<div className="divide-y divide-border">
					<ExternalLinkRow
						href={`https://evewho.com/character/${data.characterId}`}
						label={t('hrpages.eveWho')}
					/>
					<ExternalLinkRow
						href={`https://zkillboard.com/character/${data.characterId}/`}
						label={t('hrpages.zkillboard')}
					/>
					<ExternalLinkRow
						href={`https://forums.eveonline.com/search?q=%23marketplace%3Acharacter-bazaar%20%40${encodedName}`}
						label={t('hrpages.searchNewCharacterBazaar')}
					/>
					<ExternalLinkRow
						href={`https://eve-search.com/search/author/${encodedName}/forum/734105`}
						label={t('hrpages.searchOldCharacterBazaar')}
					/>
				</div>
			</CardContent>
		</Card>
	)
}

export function PublicInfoSection({ data }: { data: ProcessedPublicInfo }) {
	return (
		<div className="space-y-6">
			<PublicInfoHeader data={data} />
			<PublicInfoCard data={data} />
		</div>
	)
}
