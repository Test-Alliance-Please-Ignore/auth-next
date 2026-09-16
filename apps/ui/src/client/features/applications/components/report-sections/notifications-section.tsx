/**
 * EVE-style Notifications Section
 *
 * Left sidebar with notification type folders, right split pane with notification list (top)
 * and content (bottom). Client-side filtering, search, and pagination at 50 per page.
 */

import { useMemo, useState } from 'react'

import { getActiveLocale, i18n, useAppTranslation } from '@/i18n'
import { formatMonthDay, formatTime } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

import { EntityNameLink } from './entity-name-link'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessedNotification {
	is_read?: boolean
	notification_id?: string
	sender_id?: string
	sender_type?: 'character' | 'corporation' | 'alliance' | 'faction' | 'other'
	senderName?: string
	senderDisplayName?: string
	senderDisplayHref?: string
	text?: string
	parsedText?: Record<string, string>
	timestamp?: string
	type?: string
}

interface EnrichedNotificationData {
	notifications: ProcessedNotification[]
	types: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50

// Human-readable labels for common EVE notification types
const TYPE_LABELS: Record<string, string> = {
	get AllWarDeclaredMsg() {
		return i18n.t('hrpages.warDeclared')
	},
	get AllWarInvalidatedMsg() {
		return i18n.t('hrpages.warInvalidated')
	},
	get AllWarRetractedMsg() {
		return i18n.t('hrpages.warRetracted')
	},
	get AllWarSurrenderMsg() {
		return i18n.t('hrpages.warSurrender')
	},
	get BillOutOfMoneyMsg() {
		return i18n.t('hrpages.billOutOfMoney')
	},
	get BillPaidCorpAllMsg() {
		return i18n.t('hrpages.billPaid')
	},
	get BountyClaimMsg() {
		return i18n.t('hrpages.bountyClaim')
	},
	get CharAppAcceptMsg() {
		return i18n.t('hrpages.applicationAccepted2')
	},
	get CharAppRejectMsg() {
		return i18n.t('hrpages.applicationRejected2')
	},
	get CharAppWithdrawMsg() {
		return i18n.t('hrpages.applicationWithdrawn')
	},
	get CharLeftCorpMsg() {
		return i18n.t('hrpages.leftCorporation')
	},
	get CorpAllBillMsg() {
		return i18n.t('hrpages.corporationBill')
	},
	get CorpAppNewMsg() {
		return i18n.t('hrpages.newCorpApplication')
	},
	get CorpAppRejectCustomMsg() {
		return i18n.t('hrpages.corpAppRejected')
	},
	get CorpBecameWarEligible() {
		return i18n.t('hrpages.warEligible')
	},
	get CorpKicked() {
		return i18n.t('hrpages.corpKicked')
	},
	get CorpNewCEOMsg() {
		return i18n.t('hrpages.newCeo')
	},
	get CorpNoLongerWarEligible() {
		return i18n.t('hrpages.noLongerWarEligible')
	},
	get CorpTaxChangeMsg() {
		return i18n.t('hrpages.taxRateChanged')
	},
	get CorpVoteCEORevokedMsg() {
		return i18n.t('hrpages.ceoVoteRevoked')
	},
	get EntosisCaptureStarted() {
		return i18n.t('hrpages.entosisCaptureStarted')
	},
	get InsuranceExpirationMsg() {
		return i18n.t('hrpages.insuranceExpired')
	},
	get InsuranceFirstShipMsg() {
		return i18n.t('hrpages.firstShipInsurance')
	},
	get InsuranceIssuedMsg() {
		return i18n.t('hrpages.insuranceIssued')
	},
	get InsurancePayoutMsg() {
		return i18n.t('hrpages.insurancePayout')
	},
	get JumpCloneDeleteMsg() {
		return i18n.t('hrpages.jumpCloneDeleted')
	},
	get KillReportFinalBlow() {
		return i18n.t('hrpages.killFinalBlow')
	},
	get KillReportVictim() {
		return i18n.t('hrpages.killVictim')
	},
	get MoonminingAutomaticFracture() {
		return i18n.t('hrpages.moonMiningFracture')
	},
	get MoonminingExtractionCancelled() {
		return i18n.t('hrpages.moonExtractionCancelled')
	},
	get MoonminingExtractionFinished() {
		return i18n.t('hrpages.moonExtractionFinished')
	},
	get MoonminingExtractionStarted() {
		return i18n.t('hrpages.moonExtractionStarted')
	},
	get MoonminingLaserFired() {
		return i18n.t('hrpages.moonLaserFired')
	},
	get OrbitalAttacked() {
		return i18n.t('hrpages.orbitalAttacked')
	},
	get OrbitalReinforced() {
		return i18n.t('hrpages.orbitalReinforced')
	},
	get OwnershipTransferred() {
		return i18n.t('hrpages.ownershipTransferred')
	},
	get SkyhookDeployed() {
		return i18n.t('hrpages.skyhookDeployed')
	},
	get SkyhookDestroyed() {
		return i18n.t('hrpages.skyhookDestroyed')
	},
	get SkyhookLostShields() {
		return i18n.t('hrpages.skyhookLostShields')
	},
	get SkyhookOnline() {
		return i18n.t('hrpages.skyhookOnline')
	},
	get SkyhookUnderAttack() {
		return i18n.t('hrpages.skyhookUnderAttack')
	},
	get SovAllClaimAquiredMsg() {
		return i18n.t('hrpages.sovClaimAcquired')
	},
	get SovAllClaimLostMsg() {
		return i18n.t('hrpages.sovClaimLost')
	},
	get SovStructureDestroyed() {
		return i18n.t('hrpages.sovStructureDestroyed')
	},
	get SovStructureReinforced() {
		return i18n.t('hrpages.sovStructureReinforced')
	},
	get StructureAnchoring() {
		return i18n.t('hrpages.structureAnchoring')
	},
	get StructureDestroyed() {
		return i18n.t('hrpages.structureDestroyed')
	},
	get StructureFuelAlert() {
		return i18n.t('hrpages.structureFuelAlert')
	},
	get StructureLostArmor() {
		return i18n.t('hrpages.structureLostArmor')
	},
	get StructureLostShields() {
		return i18n.t('hrpages.structureLostShields')
	},
	get StructureOnline() {
		return i18n.t('hrpages.structureOnline')
	},
	get StructureServicesOffline() {
		return i18n.t('hrpages.structureServicesOffline')
	},
	get StructureUnanchoring() {
		return i18n.t('hrpages.structureUnanchoring')
	},
	get StructureUnderAttack() {
		return i18n.t('hrpages.structureUnderAttack')
	},
	get StructureWentHighPower() {
		return i18n.t('hrpages.structureHighPower')
	},
	get StructureWentLowPower() {
		return i18n.t('hrpages.structureLowPower')
	},
	get TowerAlertMsg() {
		return i18n.t('hrpages.posAlert')
	},
	get TowerResourceAlertMsg() {
		return i18n.t('hrpages.posResourceAlert')
	},
	get WarAdopted() {
		return i18n.t('hrpages.warAdopted')
	},
	get WarDeclared() {
		return i18n.t('hrpages.warDeclared')
	},
	get WarHQRemovedMsg() {
		return i18n.t('hrpages.warHqRemoved')
	},
	get WarInherited() {
		return i18n.t('hrpages.warInherited')
	},
	get WarRetractedByConcord() {
		return i18n.t('hrpages.warRetractedByConcord')
	},
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseData(raw: unknown): EnrichedNotificationData {
	const data = raw as EnrichedNotificationData
	return {
		notifications: data.notifications ?? [],
		types: data.types ?? [],
	}
}

function humanType(type?: string): string {
	if (!type) return i18n.t('hrpages.unknown')
	return TYPE_LABELS[type] ?? type.replace(/([A-Z])/g, ' $1').trim()
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

function searchNotifications(
	notifications: ProcessedNotification[],
	query: string
): ProcessedNotification[] {
	const q = query.toLowerCase().trim()
	if (!q) return notifications
	return notifications.filter((n) => {
		if (n.senderDisplayName?.toLowerCase().includes(q)) return true
		if (n.senderName?.toLowerCase().includes(q)) return true
		if (n.type?.toLowerCase().includes(q)) return true
		if (humanType(n.type).toLowerCase().includes(q)) return true
		if (n.text?.toLowerCase().includes(q)) return true
		return false
	})
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationsSection({ data: raw }: { data: unknown }) {
	const { t } = useAppTranslation()

	const { notifications, types } = useMemo(() => normaliseData(raw), [raw, t])

	const [activeType, setActiveType] = useState<string | null>(null)
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [page, setPage] = useState(0)
	const [searchQuery, setSearchQuery] = useState('')

	// Count notifications per type
	const typeCounts = useMemo(() => {
		const counts = new Map<string, number>()
		for (const n of notifications) {
			if (n.type) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
		}
		return counts
	}, [notifications, t])

	// Filter by type
	const typeFiltered = useMemo(() => {
		if (!activeType) return notifications
		return notifications.filter((n) => n.type === activeType)
	}, [notifications, activeType, t])

	// Filter by search
	const filtered = useMemo(
		() => searchNotifications(typeFiltered, searchQuery),
		[typeFiltered, searchQuery, t]
	)

	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
	const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

	const selectedNotification = useMemo(
		() => (selectedId ? notifications.find((n) => n.notification_id === selectedId) : null),
		[notifications, selectedId, t]
	)

	const selectType = (type: string | null) => {
		setActiveType(type)
		setPage(0)
		setSelectedId(null)
	}

	if (notifications.length === 0) {
		return <p className="text-sm text-muted-foreground">{t('hrpages.noNotificationsFound')}</p>
	}

	return (
		<div className="flex h-[700px] overflow-hidden rounded-lg border border-border bg-card/40">
			{/* ---- Left sidebar ---- */}
			<div className="flex w-52 shrink-0 flex-col border-r border-border bg-card/60">
				<div className="border-b border-border px-3 py-2">
					<span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						{t('hrpages.types')}
					</span>
				</div>
				<nav className="flex-1 overflow-y-auto py-1">
					{/* All notifications */}
					<button
						onClick={() => selectType(null)}
						className={cn(
							'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors',
							activeType === null
								? 'bg-primary/15 text-primary font-medium'
								: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
						)}
					>
						<span className="truncate">{t('hrpages.allNotifications')}</span>
						<span className="ml-1 shrink-0 text-xs tabular-nums opacity-60">
							{notifications.length}
						</span>
					</button>

					{/* Per-type folders */}
					{types.map((type) => (
						<button
							key={type}
							onClick={() => selectType(type)}
							className={cn(
								'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors',
								activeType === type
									? 'bg-primary/15 text-primary font-medium'
									: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
							)}
						>
							<span className="truncate">{humanType(type)}</span>
							<span className="ml-1 shrink-0 text-xs tabular-nums opacity-60">
								{typeCounts.get(type) ?? 0}
							</span>
						</button>
					))}
				</nav>
				<div className="border-t border-border px-3 py-2">
					<span className="text-sm text-muted-foreground">
						{notifications.length}
						{t('hrpages.total2')}
					</span>
				</div>
			</div>

			{/* ---- Right side: split pane ---- */}
			<div className="flex flex-1 flex-col overflow-hidden">
				{/* ---- Notification list (top half) ---- */}
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
							placeholder={t('hrpages.searchNotifications')}
							className="h-8 flex-1 rounded border border-border bg-background/50 px-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
						/>
						<span className="shrink-0 text-sm text-muted-foreground">
							{t('hrpages.notificationCount', { count: filtered.length })}
						</span>
						{totalPages > 1 && (
							<div className="flex shrink-0 items-center gap-1.5 text-sm">
								<button
									onClick={() => setPage((p) => Math.max(0, p - 1))}
									disabled={page === 0}
									className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
								>
									{t('hrpages.prev')}
								</button>
								<span className="text-muted-foreground">
									{page + 1}/{totalPages}
								</span>
								<button
									onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
									disabled={page >= totalPages - 1}
									className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
								>
									{t('hrpages.next')}
								</button>
							</div>
						)}
					</div>

					{/* Rows */}
					<div className="flex-1 overflow-y-auto">
						{pageItems.length === 0 ? (
							<p className="px-3 py-4 text-sm text-muted-foreground">
								{searchQuery
									? t('hrpages.noNotificationsMatchYourSearch')
									: t('hrpages.noNotificationsOfThisType')}
							</p>
						) : (
							pageItems.map((n) => {
								const isSelected = n.notification_id === selectedId
								return (
									<button
										key={n.notification_id ?? Math.random()}
										onClick={() => setSelectedId(n.notification_id ?? null)}
										className={cn(
											'flex w-full items-start gap-3 border-b border-border/40 px-3 py-2 text-left transition-colors',
											isSelected ? 'bg-primary/10' : 'hover:bg-muted/30'
										)}
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-baseline justify-between gap-2">
												<span
													className={cn(
														'truncate text-sm',
														isSelected
															? 'font-semibold text-primary'
															: 'font-medium text-foreground'
													)}
												>
													{humanType(n.type)}
												</span>
												<span className="shrink-0 text-xs text-muted-foreground">
													{formatShortDate(n.timestamp)}
												</span>
											</div>
											<div className="mt-0.5 text-xs text-muted-foreground">
												<span className="truncate">
													{t('hrpages.from2')}{' '}
													<EntityNameLink
														entityId={n.sender_id}
														entityType={n.sender_type}
														href={n.senderDisplayHref}
													>
														{n.senderDisplayName ||
															n.senderName ||
															n.sender_type ||
															t('hrpages.unknown')}
													</EntityNameLink>
												</span>
											</div>
										</div>
									</button>
								)
							})
						)}
					</div>
				</div>

				{/* ---- Notification content (bottom half) ---- */}
				<div className="flex h-[45%] shrink-0 flex-col overflow-hidden">
					{selectedNotification ? (
						<>
							<div className="border-b border-border bg-card/80 px-4 py-2">
								<h3 className="text-base font-semibold text-foreground">
									{humanType(selectedNotification.type)}
								</h3>
								<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
									<span>
										{t('hrpages.from2')}{' '}
										<strong>
											<EntityNameLink
												entityId={selectedNotification.sender_id}
												entityType={selectedNotification.sender_type}
												href={selectedNotification.senderDisplayHref}
											>
												{selectedNotification.senderDisplayName ||
													selectedNotification.senderName ||
													selectedNotification.sender_type ||
													t('hrpages.unknown')}
											</EntityNameLink>
										</strong>
									</span>
									<span className="ml-auto">
										{selectedNotification.timestamp
											? new Date(selectedNotification.timestamp).toLocaleString(getActiveLocale())
											: ''}
									</span>
								</div>
							</div>
							<div className="flex-1 overflow-y-auto px-4 py-3">
								{selectedNotification.parsedText &&
								Object.keys(selectedNotification.parsedText).length > 0 ? (
									<table className="w-full text-sm">
										<tbody>
											{Object.entries(selectedNotification.parsedText).map(([key, value]) => (
												<tr key={key} className="border-b border-border/30">
													<td className="py-1 pr-3 font-medium text-muted-foreground align-top whitespace-nowrap">
														{key}
													</td>
													<td className="py-1 text-foreground break-all">{value || '—'}</td>
												</tr>
											))}
										</tbody>
									</table>
								) : selectedNotification.text ? (
									<p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
										{selectedNotification.text}
									</p>
								) : (
									<p className="text-sm text-muted-foreground italic">
										{t('hrpages.noContentAvailable')}
									</p>
								)}
							</div>
						</>
					) : (
						<div className="flex flex-1 items-center justify-center">
							<p className="text-sm text-muted-foreground">
								{t('hrpages.selectANotificationToViewItsContent')}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
