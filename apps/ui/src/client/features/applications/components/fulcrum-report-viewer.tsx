/**
 * Fulcrum Report Viewer
 *
 * Tabbed viewer for character report data. Each tab lazy-loads
 * its section data from R2 via the API.
 */

import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { useReportSectionData, useReportSections } from '../hooks'

import {
	AssetsSection,
	ClonesSection,
	CommunicationsSection,
	ContactsSection,
	ContractsSection,
	CorpHistorySection,
	ExternalLinksCard,
	FittedShipsSection,
	PublicInfoCard,
	PublicInfoHeader,
	PublicInfoSection,
	SkillPlansProgressSection,
	SkillsSection,
	WalletJournalSection,
	WalletTransactionsSection,
} from './report-sections'
import { AlertsBanner } from './report-sections/alerts-banner'

import type { ReportSectionName } from '../api'

// ============================================================================
// Section tab configuration
// ============================================================================

interface SectionTab {
	name: ReportSectionName
	label: string
}

const SECTION_TABS: SectionTab[] = [
	{ name: 'public-info', label: 'Overview' },
	{ name: 'skills', label: 'Skills' },
	{ name: 'assets', label: 'Assets' },
	{ name: 'fitted-ships', label: 'Ships' },
	{ name: 'contracts', label: 'Contracts' },
	{ name: 'wallet-transactions', label: 'Transactions' },
	{ name: 'wallet-journal', label: 'Journal' },
	{ name: 'mails', label: 'Communications' },
	{ name: 'contacts', label: 'Contacts' },
]

// All possible data sections a complete report would contain
const ALL_DATA_SECTIONS: ReportSectionName[] = [
	'public-info',
	'skills',
	'assets',
	'fitted-ships',
	'contracts',
	'wallet-transactions',
	'wallet-journal',
	'mails',
	'contacts',
	'notifications',
	'corp-history',
	'clones',
]

const SECTION_LABELS: Record<string, string> = {
	'public-info': 'Public Info',
	skills: 'Skills',
	assets: 'Assets',
	'fitted-ships': 'Ships',
	contracts: 'Contracts',
	'wallet-transactions': 'Transactions',
	'wallet-journal': 'Journal',
	mails: 'Mails',
	contacts: 'Contacts',
	notifications: 'Notifications',
	'corp-history': 'Corp History',
	clones: 'Clones',
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
				<div className="space-y-3">
					<Skeleton className="h-6 w-48" />
					<Skeleton className="h-40 w-full" />
				</div>
			) : publicInfo ? (
				<>
					<PublicInfoHeader data={publicInfo as any} />

					{/* Info card (left) + Corp History (right) */}
					<div className={`grid gap-6 ${hasCorpHistory ? 'lg:grid-cols-[1fr_2fr]' : ''}`}>
						<div className="space-y-4">
							<div className="space-y-2">
								<h3 className="text-sm font-semibold text-foreground">Character Details</h3>
								<PublicInfoCard data={publicInfo as any} />
							</div>
							<div className="space-y-2">
								<h3 className="text-sm font-semibold text-foreground">External Links</h3>
								<ExternalLinksCard data={publicInfo as any} />
							</div>
						</div>

						{hasCorpHistory && (
							<div className="flex h-0 min-h-full flex-col gap-2">
								<h3 className="shrink-0 text-sm font-semibold text-foreground">Corporation History</h3>
								{loadingCorpHistory ? (
									<Skeleton className="h-32 w-full" />
								) : corpHistory ? (
									<CorpHistorySection data={corpHistory as any} />
								) : (
									<p className="text-sm text-muted-foreground">No corporation history available.</p>
								)}
							</div>
						)}
					</div>
				</>
			) : null}

			{/* Full-width: Clones & Implants */}
			{hasClones && (
				<div className="space-y-2 border-t border-border pt-6">
					<h3 className="text-sm font-semibold text-foreground">Clones &amp; Implants</h3>
					{loadingClones ? (
						<Skeleton className="h-32 w-full" />
					) : clones ? (
						<ClonesSection data={clones as any} />
					) : (
						<p className="text-sm text-muted-foreground">No clone data available.</p>
					)}
				</div>
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
	characterId,
}: {
	reportId: string
	section: ReportSectionName
	isActive: boolean
	availableSections: ReportSectionName[]
	characterId: string
}) {
	// Communications and Overview tabs manage their own data fetching — skip the standard fetch
	const isCommunications = section === 'mails'
	const isOverview = section === 'public-info'
	const { data, isLoading, error } = useReportSectionData(
		reportId,
		section,
		isActive && !isCommunications && !isOverview,
	)

	if (!isActive) return null

	// Communications section handles its own loading/error states
	if (isCommunications) {
		return <CommunicationsSection reportId={reportId} />
	}

	// Overview handles its own data fetching for multiple sections
	if (section === 'public-info') {
		return <OverviewContent reportId={reportId} availableSections={availableSections} />
	}

	if (isLoading) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
		)
	}

	if (error) {
		return (
			<p className="text-sm text-destructive">
				Failed to load section: {error.message}
			</p>
		)
	}

	if (!data) {
		return <p className="text-sm text-muted-foreground">No data available for this section.</p>
	}

	// Render the appropriate section component
	// Data comes from R2 JSON, so we cast through unknown → expected type
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const d = data as any
	switch (section) {
		case 'skills':
			return <SkillsContentWithSubTabs reportId={reportId} characterId={characterId} skillsData={d} />
		case 'assets':
			return <AssetsSection data={d} />
		case 'fitted-ships':
			return <FittedShipsSection data={d} />
		case 'contracts':
			return <ContractsSection data={d} />
		case 'wallet-transactions':
			return <WalletTransactionsSection data={d} />
		case 'wallet-journal':
			return <WalletJournalSection data={d} />
		case 'contacts':
			return <ContactsSection data={d} />
		default:
			return <p className="text-sm text-muted-foreground">Unknown section.</p>
	}
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

	if (!manifest || manifest.sections.length === 0) {
		return (
			<p className="text-sm text-muted-foreground py-4">
				Report has no sections available.
			</p>
		)
	}

	// Only show tabs for sections present in the manifest
	// Overview tab shows if public-info, corp-history, or clones is available
	// Communications tab shows if either mails or notifications is available
	const availableTabs = SECTION_TABS.filter((tab) => {
		if (tab.name === 'public-info') {
			return (
				manifest.sections.includes('public-info') ||
				manifest.sections.includes('corp-history') ||
				manifest.sections.includes('clones')
			)
		}
		if (tab.name === 'mails') {
			return manifest.sections.includes('mails') || manifest.sections.includes('notifications')
		}
		return manifest.sections.includes(tab.name)
	})

	// Ensure activeTab is valid
	const effectiveTab =
		availableTabs.some((t) => t.name === activeTab) && activeTab
			? activeTab
			: availableTabs[0]?.name ?? 'public-info'

	// Count sections missing from manifest (excluding 'alerts' which is internal)
	const missingSections = ALL_DATA_SECTIONS.filter(
		(s) => !manifest.sections.includes(s),
	)

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
						availableSections={manifest.sections}
						characterId={manifest.characterId}
					/>
				</TabsContent>
			))}
		</Tabs>
	)
}
