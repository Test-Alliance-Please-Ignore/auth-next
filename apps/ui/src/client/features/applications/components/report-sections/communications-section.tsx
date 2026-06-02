/**
 * Communications Section
 *
 * Combined tab with two sub-tabs: Mails and Notifications.
 * Each sub-tab lazy-loads its own section data from R2.
 */

import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { useReportSectionData } from '../../hooks'
import { AlertsBanner } from './alerts-banner'
import type { BlacklistHighlights } from './blacklist-highlighting'

import { MailsSection } from './mails-section'
import { NotificationsSection } from './notifications-section'

type SubTab = 'mails' | 'notifications'

export function CommunicationsSection({
	reportId,
	highlightedCharacterName,
	blacklistHighlights,
}: {
	reportId: string
	highlightedCharacterName?: string
	blacklistHighlights?: BlacklistHighlights
}) {
    const [activeTab, setActiveTab] = useState<SubTab>('mails')

    return (
        <div className="flex flex-col gap-0">
            {/* Sub-tab bar */}
            <div className="mb-3 flex border-b border-border">
                <button
                    type="button"
                    className={cn(
                        'px-4 py-2.5 text-base font-medium transition-colors',
                        activeTab === 'mails'
                            ? 'border-b-2 border-primary text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setActiveTab('mails')}
                >
                    Mails
                </button>
                <button
                    type="button"
                    className={cn(
                        'px-4 py-2.5 text-base font-medium transition-colors',
                        activeTab === 'notifications'
                            ? 'border-b-2 border-primary text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setActiveTab('notifications')}
                >
                    Notifications
                </button>
            </div>

            {/* Content */}
			{activeTab === 'mails' && (
				<SubTabContent
					reportId={reportId}
					section="mails"
					highlightedCharacterName={highlightedCharacterName}
					blacklistHighlights={blacklistHighlights}
				/>
			)}
            {activeTab === 'notifications' && (
                <SubTabContent reportId={reportId} section="notifications" />
            )}
        </div>
    )
}

function SubTabContent({
	reportId,
	section,
	highlightedCharacterName,
	blacklistHighlights,
}: {
	reportId: string
	section: 'mails' | 'notifications'
	highlightedCharacterName?: string
	blacklistHighlights?: BlacklistHighlights
}) {
	const { data, isLoading, error } = useReportSectionData(reportId, section, true)

	if (isLoading) {
		return (
			<div className="space-y-3">
				<AlertsBanner reportId={reportId} section={section} />
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-20 w-full" />
			</div>
		)
	}

	if (error) {
		return (
			<div className="space-y-3">
				<AlertsBanner reportId={reportId} section={section} />
				<p className="text-sm text-destructive">
					Failed to load: {error.message}
				</p>
			</div>
		)
	}

	if (!data) {
		return (
			<div className="space-y-3">
				<AlertsBanner reportId={reportId} section={section} />
				<p className="text-sm text-muted-foreground">No data available.</p>
			</div>
		)
	}

	if (section === 'mails') {
		return (
			<div className="space-y-3">
				<AlertsBanner reportId={reportId} section={section} />
				<MailsSection
					data={data}
					reportId={reportId}
					highlightedCharacterName={highlightedCharacterName}
					blacklistHighlights={blacklistHighlights}
				/>
			</div>
		)
	}
	return (
		<div className="space-y-3">
			<AlertsBanner reportId={reportId} section={section} />
			<NotificationsSection data={data} />
		</div>
	)
}
