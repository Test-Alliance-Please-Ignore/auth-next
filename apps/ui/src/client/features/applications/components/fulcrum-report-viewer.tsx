/**
 * Fulcrum Report Viewer
 *
 * Tabbed viewer for character report data. Each tab lazy-loads
 * its section data from R2 via the API.
 */

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEntityNames } from '@/hooks/useEntityNames'
import { cn } from '@/lib/utils'

import { useReportSectionData, useReportSections } from '../hooks'
import { ALL_DATA_SECTIONS, SECTION_LABELS, SECTION_TABS } from '../constants'
import type { SectionTab } from '../constants'

import {
	AssetsSection,
	ClonesSection,
	CommunicationsSection,
	ContactsSection,
	ContractsSection,
	CorpHistorySection,
	ExternalLinksCard,
	FittedShipsSection,
	OrdersSection,
	PublicInfoCard,
	PublicInfoHeader,
	PublicInfoSection,
	SkillPlansProgressSection,
	SkillsSection,
	WalletJournalSection,
	WalletTransactionsSection,
} from './report-sections'
import { AlertsBanner } from './report-sections/alerts-banner'
import { extractBlacklistHighlights } from './report-sections/blacklist-highlighting'

import type { ReportSectionMeta, ReportSectionName } from '../api'

type LegacyBlacklistSignals = {
	hasAnyBlacklistSignal?: boolean
	ipAssociatedBlacklistedUsers?: Array<{
		userId: string
		mainCharacterId: string
		mainCharacterName: string | null
	}>
}

type LegacyAssociationItem = {
	id: string
	legacyAuthUserId: string
	status: string
	modernUserMainCharacterName: string | null
	conflicts: Record<string, unknown>
	candidates: {
		characters: Array<{
			characterId: string
			characterName: string
			source: 'legacy_primary' | 'esi_owner' | 'xml_account'
			corporationId: string | null
			corporationName: string | null
			allianceId: string | null
			allianceName: string | null
			isDeleted: boolean
			alreadyLinkedToModernUser: boolean
			linkedToOtherUserId: string | null
		}>
		notes: Array<{
			legacyNoteId: string
			note: string
			legacyCreatedByCharacterName: string | null
			alreadyImported: boolean
		}>
		ipAddressCount: number
	}
}

function LegacyDataSection({ data }: { data: unknown }) {
	const alertsPayload = data as { alerts?: Array<{ type: string; details?: Record<string, unknown> }> }
	const legacyAlert = alertsPayload?.alerts?.find((alert) => alert.type === 'legacy-additional-associations')
	const items = (legacyAlert?.details?.items as LegacyAssociationItem[] | undefined) ?? []

	if (items.length === 0) {
		return <p className="text-sm text-muted-foreground">No legacy associations found for this report owner.</p>
	}

	return (
		<div className="space-y-4">
			{items.map((item) => {
				const blacklistSignals = (item.conflicts?.blacklistSignals as LegacyBlacklistSignals | undefined) ?? {}
				const ipAssociatedMatches = blacklistSignals.ipAssociatedBlacklistedUsers ?? []
				return (
					<Card key={item.id}>
						<CardContent className="pt-6 space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-sm font-semibold">Legacy User {item.legacyAuthUserId}</h3>
								<Badge variant="secondary">{item.status}</Badge>
								{blacklistSignals.hasAnyBlacklistSignal ? (
									<Badge variant="destructive">Blocklist Alert</Badge>
								) : null}
							</div>

							<div className="space-y-2">
								<p className="text-xs font-semibold text-muted-foreground">Character Matches</p>
								{item.candidates.characters.length === 0 ? (
									<p className="text-sm text-muted-foreground">None</p>
								) : (
									item.candidates.characters.map((character) => (
										<div key={character.characterId} className="rounded border border-border/90 bg-card/80 p-2.5">
											<div className="flex items-center justify-between gap-3">
												<div className="min-w-0">
													<div className="font-medium">{character.characterName}</div>
													<div className="text-xs font-mono text-muted-foreground">{character.characterId}</div>
													{character.corporationName || character.allianceName ? (
														<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white">
															{character.corporationName ? (
																<span className="inline-flex items-center gap-1.5">
																	{character.corporationId ? (
																		<img
																			src={`https://images.evetech.net/corporations/${character.corporationId}/logo?size=32`}
																			alt={character.corporationName}
																			className="h-4 w-4 rounded-sm"
																			loading="lazy"
																		/>
																	) : null}
																	<span>{character.corporationName}</span>
																</span>
															) : null}
															{character.allianceName ? (
																<span className="inline-flex items-center gap-1.5">
																	{character.allianceId ? (
																		<img
																			src={`https://images.evetech.net/alliances/${character.allianceId}/logo?size=32`}
																			alt={character.allianceName}
																			className="h-4 w-4 rounded-sm"
																			loading="lazy"
																		/>
																	) : null}
																	<span>{character.allianceName}</span>
																</span>
															) : null}
														</div>
													) : null}
												</div>
												{character.alreadyLinkedToModernUser ? (
													<Badge variant="success">Already linked</Badge>
												) : character.linkedToOtherUserId ? (
													<Badge variant="destructive">Linked to other user</Badge>
												) : character.isDeleted ? (
													<Badge variant="warning">Deleted</Badge>
												) : (
													<Badge variant="warning">Not linked</Badge>
												)}
											</div>
										</div>
									))
								)}
							</div>

							<div className="space-y-2">
								<p className="text-xs font-semibold text-muted-foreground">Legacy Notes</p>
								{item.candidates.notes.length === 0 ? (
									<p className="text-sm text-muted-foreground">None</p>
								) : (
									item.candidates.notes.map((note) => (
										<div key={note.legacyNoteId} className="rounded border border-border/90 bg-card/80 p-2.5">
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0 text-sm whitespace-pre-wrap">{note.note}</div>
												{note.alreadyImported ? (
													<Badge variant="success">Already imported</Badge>
												) : (
													<Badge variant="warning">Not linked</Badge>
												)}
											</div>
											{note.legacyCreatedByCharacterName ? (
												<div className="mt-1 text-xs text-muted-foreground">by {note.legacyCreatedByCharacterName}</div>
											) : null}
										</div>
									))
								)}
							</div>

							<div className="space-y-2">
								<p className="text-xs font-semibold text-muted-foreground">IP-associated Modern Users</p>
								<div className="text-xs text-muted-foreground">
									Legacy IP addresses: {item.candidates.ipAddressCount}
								</div>
								{ipAssociatedMatches.length === 0 ? (
									<p className="text-sm text-muted-foreground">None</p>
								) : (
									<div className="space-y-1">
										{ipAssociatedMatches.map((match) => (
											<div key={`${item.id}:${match.userId}`} className="text-sm rounded border border-border/90 bg-card/80 p-2">
												{match.mainCharacterName ?? match.mainCharacterId}{' '}
												<span className="font-mono text-xs text-muted-foreground">({match.userId})</span>
											</div>
										))}
									</div>
								)}
							</div>
						</CardContent>
					</Card>
				)
			})}
		</div>
	)
}

// ============================================================================
// Overview Content (combines public-info, corp-history, and clones)
// ============================================================================

function OverviewContent({
	reportId,
	availableSections,
}: {
	reportId: string
	availableSections: ReportSectionName[]
}) {
	const hasCorpHistory = availableSections.includes('corp-history')
	const hasClones = availableSections.includes('clones')

	const { data: publicInfo, isLoading: loadingPublic } = useReportSectionData(
		reportId,
		'public-info',
		true,
	)
	const { data: corpHistory, isLoading: loadingCorpHistory } = useReportSectionData(
		reportId,
		'corp-history',
		hasCorpHistory,
	)
	const { data: clones, isLoading: loadingClones } = useReportSectionData(
		reportId,
		'clones',
		hasClones,
	)

	return (
		<div className="space-y-6">
			<AlertsBanner reportId={reportId} />

			{/* Character Header - full width */}
			{loadingPublic ? (
				<Card>
					<CardContent className="pt-6">
						<div className="space-y-3">
							<Skeleton className="h-6 w-48" />
							<Skeleton className="h-40 w-full" />
						</div>
					</CardContent>
				</Card>
			) : publicInfo ? (
				<>
					<Card>
						<CardContent className="pt-6">
							<PublicInfoHeader data={publicInfo as any} />
						</CardContent>
					</Card>

					{/* Info card (left) + Corp History (right) */}
					<div className={`grid gap-6 ${hasCorpHistory ? 'lg:grid-cols-[1fr_2fr]' : ''}`}>
						<div className="space-y-4">
							<Card>
								<CardContent className="pt-6">
									<div className="space-y-2">
										<h3 className="text-sm font-semibold text-foreground">Character Details</h3>
										<PublicInfoCard data={publicInfo as any} />
									</div>
									<div className="mt-4 space-y-2">
										<h3 className="text-sm font-semibold text-foreground">External Links</h3>
										<ExternalLinksCard data={publicInfo as any} />
									</div>
								</CardContent>
							</Card>
						</div>

						{hasCorpHistory && (
							<Card className="flex h-0 min-h-full flex-col">
								<CardContent className="flex min-h-0 flex-1 flex-col gap-2 pt-6">
									<h3 className="shrink-0 text-sm font-semibold text-foreground">Corporation History</h3>
									{loadingCorpHistory ? (
										<Skeleton className="h-32 w-full" />
									) : corpHistory ? (
										<CorpHistorySection data={corpHistory as any} />
									) : (
										<p className="text-sm text-muted-foreground">No corporation history available.</p>
									)}
								</CardContent>
							</Card>
						)}
					</div>
				</>
			) : null}

			{/* Full-width: Clones & Implants */}
			{hasClones && (
				<Card>
					<CardContent className="pt-6">
						<h3 className="mb-2 text-sm font-semibold text-foreground">Clones &amp; Implants</h3>
						{loadingClones ? (
							<Skeleton className="h-32 w-full" />
						) : clones ? (
							<ClonesSection data={clones as any} />
						) : (
							<p className="text-sm text-muted-foreground">No clone data available.</p>
						)}
					</CardContent>
				</Card>
			)}
		</div>
	)
}

// ============================================================================
// Section Content (lazy-loads data when tab is active)
// ============================================================================

function SkillsContentWithSubTabs({
	reportId,
	characterId,
	skillsData,
}: {
	reportId: string
	characterId: string
	skillsData: unknown
}) {
	const [subTab, setSubTab] = useState<'skills' | 'skill-plans'>('skills')

	return (
		<div className="space-y-4">
			<div className="flex gap-1 rounded-lg border p-1 w-fit">
				<button
					type="button"
					className={cn(
						'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
						subTab === 'skills'
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
					onClick={() => setSubTab('skills')}
				>
					Skills
				</button>
				<button
					type="button"
					className={cn(
						'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
						subTab === 'skill-plans'
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
					onClick={() => setSubTab('skill-plans')}
				>
					Skill Plans
				</button>
			</div>

			{subTab === 'skills' ? (
				<SkillsSection data={skillsData as any} />
			) : (
				<SkillPlansProgressSection characterId={characterId} />
			)}
		</div>
	)
}

function SectionContent({
	reportId,
	section,
	isActive,
	availableSections,
	sectionMeta,
	characterId,
	highlightedCharacterName,
}: {
	reportId: string
	section: ReportSectionName
	isActive: boolean
	availableSections: ReportSectionName[]
	sectionMeta?: ReportSectionMeta
	characterId: string
	highlightedCharacterName?: string
}) {
	// Communications and Overview tabs manage their own data fetching — skip the standard fetch
	const isCommunications = section === 'mails'
	const isOverview = section === 'public-info'
	const sectionAlerts =
		section !== 'public-info' ? <AlertsBanner reportId={reportId} section={section} /> : null
	const needsBlacklistHighlights = section === 'contacts' || section === 'mails'
	const { data: alertData } = useReportSectionData(
		reportId,
		'alerts',
		isActive && needsBlacklistHighlights,
	)
	const blacklistHighlights = needsBlacklistHighlights ? extractBlacklistHighlights(alertData) : undefined
	const { data, isLoading, error, chunkProgress } = useReportSectionData(
		reportId,
		section,
		isActive &&
			!isCommunications &&
			!isOverview,
		sectionMeta,
	)

	if (!isActive) return null

	// Communications section handles its own loading/error states
	if (isCommunications) {
		return (
			<div className="space-y-4">
				<Card>
					<CardContent className="pt-6">
						<CommunicationsSection
							reportId={reportId}
							highlightedCharacterName={highlightedCharacterName}
							blacklistHighlights={blacklistHighlights}
						/>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Overview handles its own data fetching for multiple sections
	if (section === 'public-info') {
		return <OverviewContent reportId={reportId} availableSections={availableSections} />
	}

	if (section === 'wallet-transactions' && (sectionMeta?.chunks ?? 0) > 0 && !error) {
		return (
			<WalletTransactionsSection
				data={data as any}
				loadingProgress={chunkProgress}
			/>
		)
	}

	if (section === 'wallet-journal' && (sectionMeta?.chunks ?? 0) > 0 && !error) {
		return (
			<WalletJournalSection
				data={data as any}
				loadingProgress={chunkProgress}
			/>
		)
	}

	if (isLoading) {
		return (
			<div className="space-y-4">
				{sectionAlerts}
				<Card>
					<CardContent className="pt-6">
						<div className="space-y-3">
							<Skeleton className="h-6 w-48" />
							<Skeleton className="h-40 w-full" />
							<Skeleton className="h-20 w-full" />
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (error) {
		return (
			<div className="space-y-4">
				{sectionAlerts}
				<Card>
					<CardContent className="pt-6">
						<p className="text-sm text-destructive">
							Failed to load section: {error.message}
						</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	if (!data) {
		return (
			<div className="space-y-4">
				{sectionAlerts}
				<Card>
					<CardContent className="pt-6">
						<p className="text-sm text-muted-foreground">No data available for this section.</p>
					</CardContent>
				</Card>
			</div>
		)
	}

	// Render the appropriate section component
	// Data comes from R2 JSON, so we cast through unknown → expected type
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = data as any
	const content = (() => {
		switch (section) {
			case 'skills':
				return <SkillsContentWithSubTabs reportId={reportId} characterId={characterId} skillsData={d} />
			case 'assets':
				return <AssetsSection data={d} />
			case 'fitted-ships':
				return <FittedShipsSection data={d} />
			case 'orders':
				return <OrdersSection data={d} />
			case 'contracts':
				return <ContractsSection data={d} />
			case 'wallet-transactions':
				return <WalletTransactionsSection data={d} />
			case 'wallet-journal':
				return <WalletJournalSection data={d} />
			case 'contacts':
				return <ContactsSection data={d} blacklistHighlights={blacklistHighlights} />
			case 'alerts':
				return <LegacyDataSection data={d} />
			default:
				return <p className="text-sm text-muted-foreground">Unknown section.</p>
		}
	})()

	return (
		<div className="space-y-4">
			{sectionAlerts}
			<Card>
				<CardContent className="pt-6">
					{content}
				</CardContent>
			</Card>
		</div>
	)
}

// ============================================================================
// Main Component
// ============================================================================

interface FulcrumReportViewerProps {
	reportId: string
}

export function FulcrumReportViewer({ reportId }: FulcrumReportViewerProps) {
	const { data: manifest, isLoading, error } = useReportSections(reportId)
	const [activeTab, setActiveTab] = useState<string>('public-info')
	const { data: characterNames = {} } = useEntityNames(
		manifest?.characterId ? [manifest.characterId] : [],
		{ enabled: !!manifest?.characterId }
	)

	if (isLoading) {
		return (
			<div className="space-y-3 py-4">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-60 w-full" />
			</div>
		)
	}

	if (error) {
		return (
			<p className="text-sm text-destructive py-4">
				Failed to load report: {error.message}
			</p>
		)
	}

	if (!manifest || Object.keys(manifest.sections).length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-4">
				Report has no sections available.
			</p>
		)
	}

	const hasSection = (name: ReportSectionName) => name in manifest.sections
	const availableSectionNames = Object.keys(manifest.sections) as ReportSectionName[]
	const highlightedCharacterName = manifest.characterId ? characterNames[manifest.characterId] : undefined

	// Only show tabs for sections present in the manifest
	// Overview tab shows if public-info, corp-history, or clones is available
	// Communications tab shows if either mails or notifications is available
	const availableTabs = SECTION_TABS.filter((tab) => {
		if (tab.name === 'public-info') {
			return (
				hasSection('public-info') ||
				hasSection('corp-history') ||
				hasSection('clones')
			)
		}
		if (tab.name === 'mails') {
			return hasSection('mails') || hasSection('notifications')
		}
		return hasSection(tab.name as ReportSectionName)
	})

	// Ensure activeTab is valid
	const effectiveTab =
		availableTabs.some((t) => t.name === activeTab) && activeTab
			? activeTab
			: availableTabs[0]?.name ?? 'public-info'

	// Count sections missing from manifest (excluding 'alerts' which is internal)
	const missingSections = ALL_DATA_SECTIONS.filter((s) => !hasSection(s))

	return (
		<Tabs value={effectiveTab} onValueChange={setActiveTab} className="w-full">
			<div className="flex items-center gap-3">
				<TabsList className="flex-wrap">
					{availableTabs.map((tab) => (
						<TabsTrigger key={tab.name} value={tab.name}>
							{tab.label}
						</TabsTrigger>
					))}
				</TabsList>
				{missingSections.length > 0 && (
					<span
						className="text-xs text-muted-foreground"
						title={`Missing: ${missingSections.map((s) => SECTION_LABELS[s] ?? s).join(', ')}`}
					>
						{missingSections.length} section{missingSections.length !== 1 ? 's' : ''} unavailable
					</span>
				)}
			</div>

			{availableTabs.map((tab) => (
				<TabsContent key={tab.name} value={tab.name}>
					<SectionContent
						reportId={reportId}
						section={tab.name}
						isActive={effectiveTab === tab.name}
						availableSections={availableSectionNames}
						sectionMeta={manifest.sections[tab.name]}
						characterId={manifest.characterId}
						highlightedCharacterName={highlightedCharacterName}
					/>
				</TabsContent>
			))}
		</Tabs>
	)
}
