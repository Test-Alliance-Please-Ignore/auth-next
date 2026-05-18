/**
 * EVE-style Mail Section
 *
 * Left sidebar with folder tree, right split pane with mail list (top) and content (bottom).
 * Uses EVE standard label IDs for folder categorization (1=Inbox, 2=Sent, 4=Corp, 8=Alliance).
 * Client-side filtering by folder/label, search, and pagination at 50 mails per page.
 */

import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { formatMonthDay, formatTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import { fulcrumApi } from '../../api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MailRecipient {
	recipient_id: string
	recipient_type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
	recipientName?: string
}

interface ProcessedMail {
	mail_id?: string
	from?: string
	fromName?: string
	subject?: string
	labels?: string[]
	recipients?: MailRecipient[]
	body?: string
	bodyPlainText?: string
	timestampFormatted?: string
	timestamp?: string
}

interface MailingList {
	mailing_list_id: string
	name: string
}

interface MailLabel {
	color?: string
	label_id: string
	name?: string
	unread_count?: number
}

interface MailLabelsResponse {
	labels?: MailLabel[]
	total_unread_count?: number
}

interface EnrichedMailData {
	mails: ProcessedMail[]
	mailingLists: MailingList[]
	labels: MailLabelsResponse
}

// ---------------------------------------------------------------------------
// EVE standard label IDs
// ---------------------------------------------------------------------------

const EVE_LABEL_INBOX = '1'
const EVE_LABEL_SENT = '2'
const EVE_LABEL_CORP = '4'
const EVE_LABEL_ALLIANCE = '8'

// ---------------------------------------------------------------------------
// Folder definitions
// ---------------------------------------------------------------------------

type FolderType =
	| 'all'
	| 'inbox'
	| 'sent'
	| 'corp'
	| 'alliance'
	| `mailing_list:${string}`

interface FolderDef {
	id: FolderType
	label: string
}

const STATIC_FOLDERS: FolderDef[] = [
	{ id: 'all', label: 'All Mails' },
	{ id: 'inbox', label: 'Inbox' },
	{ id: 'sent', label: 'Sent' },
	{ id: 'corp', label: 'Corporation' },
	{ id: 'alliance', label: 'Alliance' },
]

const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseData(raw: unknown): EnrichedMailData {
	const data = raw as EnrichedMailData
	return {
		mails: data.mails ?? [],
		mailingLists: data.mailingLists ?? [],
		labels: data.labels ?? {},
	}
}

/** Filter mails by folder using EVE standard label IDs. */
function filterMails(mails: ProcessedMail[], folder: FolderType): ProcessedMail[] {
	switch (folder) {
		case 'all':
			return mails
		case 'inbox':
			return mails.filter((m) => m.labels?.includes(EVE_LABEL_INBOX))
		case 'sent':
			return mails.filter((m) => m.labels?.includes(EVE_LABEL_SENT))
		case 'corp':
			return mails.filter((m) => m.labels?.includes(EVE_LABEL_CORP))
		case 'alliance':
			return mails.filter((m) => m.labels?.includes(EVE_LABEL_ALLIANCE))
		default:
			if (folder.startsWith('mailing_list:')) {
				const mlId = folder.slice('mailing_list:'.length)
				return mails.filter((m) =>
					m.recipients?.some(
						(r) => r.recipient_type === 'mailing_list' && r.recipient_id === mlId,
					),
				)
			}
			return mails
	}
}

/** Filter mails by search query (subject, sender, recipients, body). */
function searchMails(mails: ProcessedMail[], query: string): ProcessedMail[] {
	const q = query.toLowerCase().trim()
	if (!q) return mails
	return mails.filter((m) => {
		if (m.subject?.toLowerCase().includes(q)) return true
		if (m.fromName?.toLowerCase().includes(q)) return true
		if (m.bodyPlainText?.toLowerCase().includes(q)) return true
		if (m.recipients?.some((r) => r.recipientName?.toLowerCase().includes(q))) return true
		return false
	})
}

function formatShortDate(timestamp?: string): string {
	if (!timestamp) return ''
	const d = new Date(timestamp)
	if (isNaN(d.getTime())) return ''
	const now = new Date()
	const isToday = d.toDateString() === now.toDateString()
	if (isToday) {
		return formatTime(d)
	}
	return formatMonthDay(d)
}

function recipientSummary(recipients?: MailRecipient[]): string {
	if (!recipients || recipients.length === 0) return ''
	return recipients
		.map((r) => r.recipientName || `ID:${r.recipient_id}`)
		.join(', ')
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(value: string | undefined, needle: string | undefined): ReactNode {
	if (!value) return ''
	if (!needle || !needle.trim()) return value
	const pattern = new RegExp(`(${escapeRegExp(needle.trim())})`, 'ig')
	const parts = value.split(pattern)
	return parts.map((part, index) =>
		part.toLowerCase() === needle.trim().toLowerCase()
			? (
				<mark key={`${part}-${index}`} className="rounded bg-amber-400/20 px-0.5 font-semibold text-foreground">
					{part}
				</mark>
			)
			: part
	)
}

function hasCharacterMention(mail: ProcessedMail, highlightedCharacterName?: string): boolean {
	if (!highlightedCharacterName?.trim()) return false
	const needle = highlightedCharacterName.toLowerCase()
	return (
		(mail.fromName ?? '').toLowerCase().includes(needle)
		|| (mail.subject ?? '').toLowerCase().includes(needle)
		|| (mail.bodyPlainText ?? '').toLowerCase().includes(needle)
		|| (mail.recipients?.some((recipient) => (recipient.recipientName ?? '').toLowerCase().includes(needle)) ?? false)
	)
}

export function MailsSection({
	data: raw,
	reportId,
	highlightedCharacterName,
}: {
	data: unknown
	reportId: string
	highlightedCharacterName?: string
}) {
	const { mails, mailingLists } = useMemo(() => normaliseData(raw), [raw])

	const [activeFolder, setActiveFolder] = useState<FolderType>('all')
	const [selectedMailId, setSelectedMailId] = useState<string | null>(null)
	const [page, setPage] = useState(0)
	const [mlExpanded, setMlExpanded] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')

	// On-demand mail content loading
	const [loadedBodies, setLoadedBodies] = useState<Record<string, string>>({})
	const [loadingMailId, setLoadingMailId] = useState<string | null>(null)

	const handleLoadContent = useCallback(async (mailId: string) => {
		setLoadingMailId(mailId)
		try {
			const { body } = await fulcrumApi.fetchMailContent(reportId, mailId)
			setLoadedBodies((prev) => ({ ...prev, [mailId]: body }))
		} catch {
			// Leave the button visible so the user can retry
		} finally {
			setLoadingMailId(null)
		}
	}, [reportId])

	const folderFiltered = useMemo(
		() => filterMails(mails, activeFolder),
		[mails, activeFolder],
	)

	const filtered = useMemo(
		() => searchMails(folderFiltered, searchQuery),
		[folderFiltered, searchQuery],
	)

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
	const pageMails = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

	const selectedMail = useMemo(
		() => (selectedMailId ? mails.find((m) => m.mail_id === selectedMailId) : null),
		[mails, selectedMailId],
	)

	// Reset page when folder changes
	const selectFolder = (f: FolderType) => {
		setActiveFolder(f)
		setPage(0)
		setSelectedMailId(null)
	}

	if (mails.length === 0) {
		return <p className="text-sm text-muted-foreground">No mails found.</p>
	}

	// ------ Mailing list folders ------
	const mlFolders: FolderDef[] = mailingLists.map((ml) => ({
		id: `mailing_list:${ml.mailing_list_id}` as FolderType,
		label: ml.name,
	}))

	return (
		<div className="flex h-[75vh] min-h-[760px] max-h-[1400px] resize-y overflow-hidden rounded-lg border border-border bg-card/40">
			{/* ---- Left sidebar ---- */}
			<div className="flex w-48 shrink-0 flex-col border-r border-border bg-card/60">
				<div className="border-b border-border px-3 py-2">
					<span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						Folders
					</span>
				</div>
				<nav className="flex-1 overflow-y-auto py-1">
					{STATIC_FOLDERS.map((f) => (
						<button
							key={f.id}
							onClick={() => selectFolder(f.id)}
							className={cn(
								'flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors',
								activeFolder === f.id
									? 'bg-primary/15 text-primary font-medium'
									: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
							)}
						>
							<span className="truncate">{f.label}</span>
						</button>
					))}

					{/* Mailing lists */}
					{mlFolders.length > 0 && (
						<>
							<button
								onClick={() => setMlExpanded((v) => !v)}
								className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-sm text-muted-foreground hover:text-foreground"
							>
								<span className="text-[10px]">{mlExpanded ? '▾' : '▸'}</span>
								<span className="font-semibold uppercase tracking-wider text-muted-foreground">
									Mailing Lists
								</span>
							</button>
							{mlExpanded &&
								mlFolders.map((f) => (
									<button
										key={f.id}
										onClick={() => selectFolder(f.id)}
										className={cn(
											'flex w-full items-center py-1.5 pl-5 pr-3 text-left text-sm transition-colors',
											activeFolder === f.id
												? 'bg-primary/15 text-primary font-medium'
												: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
										)}
									>
										<span className="truncate">{f.label}</span>
									</button>
								))}
						</>
					)}
				</nav>
				<div className="border-t border-border px-3 py-2">
					<span className="text-sm text-muted-foreground">
						{mails.length} total
					</span>
				</div>
			</div>

			{/* ---- Right side: split pane ---- */}
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* ---- Mail list (top half) ---- */}
				<div className="flex h-[55%] shrink-0 flex-col border-b border-border">
					{/* Header with search */}
					<div className="flex items-center gap-2 border-b border-border bg-card/80 px-3 py-1.5">
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => {
								setSearchQuery(e.target.value)
								setPage(0)
							}}
							placeholder="Search mails..."
							className="h-8 flex-1 rounded border border-border bg-background/50 px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
						/>
						<span className="shrink-0 text-sm text-muted-foreground">
							{filtered.length} mail{filtered.length !== 1 ? 's' : ''}
						</span>
						{totalPages > 1 && (
							<div className="flex shrink-0 items-center gap-1.5 text-sm">
								<button
									onClick={() => setPage((p) => Math.max(0, p - 1))}
									disabled={page === 0}
									className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
								>
									‹ Prev
								</button>
								<span className="text-muted-foreground">
									{page + 1}/{totalPages}
								</span>
								<button
									onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
									disabled={page >= totalPages - 1}
									className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
								>
									Next ›
								</button>
							</div>
						)}
					</div>

					{/* Rows */}
					<div className="flex-1 overflow-y-auto">
						{pageMails.length === 0 ? (
							<p className="px-3 py-4 text-sm text-muted-foreground">
								{searchQuery ? 'No mails match your search.' : 'No mails in this folder.'}
							</p>
						) : (
							pageMails.map((mail) => {
								const isSelected = mail.mail_id === selectedMailId
								return (
									<button
										key={mail.mail_id ?? Math.random()}
										onClick={() => setSelectedMailId(mail.mail_id ?? null)}
										className={cn(
											'flex w-full items-start gap-3 border-b border-border/40 px-3 py-2 text-left transition-colors',
											isSelected
												? 'bg-primary/10'
												: 'hover:bg-muted/30',
										)}
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-baseline justify-between gap-2">
												<span
													className={cn(
														'truncate text-sm',
														isSelected ? 'font-semibold text-primary' : 'font-medium text-foreground',
													)}
												>
													{mail.subject || '(No Subject)'}
												</span>
												<span className="shrink-0 text-xs text-muted-foreground">
													{formatShortDate(mail.timestamp)}
												</span>
											</div>
											<div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
										<span className={cn(hasCharacterMention(mail, highlightedCharacterName) && 'font-semibold text-foreground')}>
											From: {highlightText(mail.fromName || 'Unknown', highlightedCharacterName)}
										</span>
										{mail.recipients && mail.recipients.length > 0 && (
											<span className={cn('truncate', hasCharacterMention(mail, highlightedCharacterName) && 'font-semibold text-foreground')}>
												→ {highlightText(recipientSummary(mail.recipients), highlightedCharacterName)}
											</span>
										)}
											</div>
										</div>
									</button>
								)
							})
						)}
					</div>
				</div>

				{/* ---- Mail content (bottom half) ---- */}
				<div className="flex h-[45%] shrink-0 flex-col overflow-hidden">
					{selectedMail ? (
						<>
							<div className="border-b border-border bg-card/80 px-4 py-2">
								<h3 className="text-base font-semibold text-foreground">
									{selectedMail.subject || '(No Subject)'}
								</h3>
								<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
									<span className={cn(hasCharacterMention(selectedMail, highlightedCharacterName) && 'font-semibold text-foreground')}>
										From: <strong>{selectedMail.fromName || 'Unknown'}</strong>
									</span>
									{selectedMail.recipients && selectedMail.recipients.length > 0 && (
										<span className="flex flex-wrap items-center gap-1">
											To:{' '}
											{selectedMail.recipients.map((r, i) => (
												<Badge key={i} variant="secondary" className="text-xs py-0">
													{highlightText(r.recipientName || `ID: ${r.recipient_id}`, highlightedCharacterName)}
												</Badge>
											))}
										</span>
									)}
									<span className="ml-auto">
										{selectedMail.timestampFormatted ||
											(selectedMail.timestamp
												? new Date(selectedMail.timestamp).toLocaleString()
												: '')}
									</span>
								</div>
							</div>
							<div className="flex-1 overflow-y-auto px-4 py-3">
								{(() => {
									const bodyText = selectedMail.bodyPlainText || (selectedMail.mail_id ? loadedBodies[selectedMail.mail_id] : undefined)
									if (bodyText) {
										return (
											<p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
												{highlightText(bodyText, highlightedCharacterName)}
											</p>
										)
									}
									if (!selectedMail.mail_id) {
										return (
											<p className="text-sm text-muted-foreground italic">
												No content available.
											</p>
										)
									}
									return (
										<div className="flex flex-col items-center justify-center gap-2 py-4">
											<p className="text-sm text-muted-foreground italic">
												Content was not fetched during report generation.
											</p>
											<button
												onClick={() => handleLoadContent(selectedMail.mail_id!)}
												disabled={loadingMailId === selectedMail.mail_id}
												className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
											>
												{loadingMailId === selectedMail.mail_id
													? 'Loading...'
													: 'Load content'}
											</button>
										</div>
									)
								})()}
							</div>
						</>
					) : (
						<div className="flex flex-1 items-center justify-center">
							<p className="text-sm text-muted-foreground">
								Select a mail to view its content.
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
