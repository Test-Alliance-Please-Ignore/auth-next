/**
 * Public Info Section - Character overview
 */

import { ExternalLink } from 'lucide-react'

import { MemberAvatar } from '@/components/member-avatar'
import { Card, CardContent } from '@/components/ui/card'

interface ProcessedPublicInfo {
	characterId: string
	characterName: string
	birthday: string
	corporationId: string
	corporationName?: string
	allianceId?: string
	allianceName?: string
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

export function PublicInfoHeader({ data }: { data: ProcessedPublicInfo }) {
	return (
		<div className="flex items-center gap-4">
			<MemberAvatar
				characterId={data.characterId}
				characterName={data.characterName}
				size="lg"
			/>
			<div>
				<h3 className="text-xl font-bold text-foreground">{data.characterName}</h3>
				{data.title && <p className="text-sm text-muted-foreground">{data.title}</p>}
			</div>
		</div>
	)
}

export function PublicInfoCard({ data }: { data: ProcessedPublicInfo }) {
	const secStatus = data.securityStatus ? parseFloat(data.securityStatus).toFixed(2) : null

	return (
		<Card variant="flat">
			<CardContent className="pt-4">
				<div className="divide-y divide-border">
					<SimpleInfoRow label="Birthday" value={new Date(data.birthday).toLocaleDateString()} />
					<SimpleInfoRow label="Race" value={data.raceName} />
					<SimpleInfoRow label="Bloodline" value={data.bloodlineName} />
					<SimpleInfoRow label="Security Status" value={secStatus} />
					{data.corporationId && (
						<InfoRow label="Corporation">
							<img
								src={`https://images.evetech.net/corporations/${data.corporationId}/logo?size=32`}
								alt=""
								className="h-5 w-5 rounded"
							/>
							<span className="text-sm font-medium text-foreground">
								{data.corporationName || data.corporationId}
							</span>
						</InfoRow>
					)}
					{data.allianceId && (
						<InfoRow label="Alliance">
							<img
								src={`https://images.evetech.net/alliances/${data.allianceId}/logo?size=32`}
								alt=""
								className="h-5 w-5 rounded"
							/>
							<span className="text-sm font-medium text-foreground">
								{data.allianceName}
							</span>
						</InfoRow>
					)}
					<SimpleInfoRow label="Faction" value={data.factionName} />
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
	const encodedName = encodeURIComponent(data.characterName)

	return (
		<Card variant="flat">
			<CardContent className="pt-4">
				<div className="divide-y divide-border">
					<ExternalLinkRow
						href={`https://evewho.com/character/${data.characterId}`}
						label="EVE Who"
					/>
					<ExternalLinkRow
						href={`https://zkillboard.com/character/${data.characterId}/`}
						label="zKillboard"
					/>
					<ExternalLinkRow
						href={`https://forums.eveonline.com/search?q=%23marketplace%3Acharacter-bazaar%20%40${encodedName}`}
						label="Search New Character Bazaar"
					/>
					<ExternalLinkRow
						href={`https://eve-search.com/search/author/${encodedName}/forum/734105`}
						label="Search Old Character Bazaar"
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
