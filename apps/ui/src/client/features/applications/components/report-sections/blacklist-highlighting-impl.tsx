import type { ReactNode } from 'react'

import { HoverPopover } from '@/components/ui/hover-popover'
import { cn } from '@/lib/utils'
import { renderBlacklistContextLine } from '../../utils/blacklist-context'

type BlacklistAssociationAlert = {
	type: string
	details?: {
		associations?: Array<{
			characterId?: string
			characterName?: string
			matches?: Array<{
				source?: string
				detail?: string
				occurredAt?: string
			}>
		}>
	}
}

type ReportAlerts = {
	alerts?: BlacklistAssociationAlert[]
}

export interface BlacklistHighlights {
	ids: Set<string>
	names: Set<string>
	contextsById: Record<string, string[]>
	contextsByName: Record<string, string[]>
}

export function extractBlacklistHighlights(raw: unknown): BlacklistHighlights {
	const ids = new Set<string>()
	const names = new Set<string>()
	const contextsById: Record<string, string[]> = {}
	const contextsByName: Record<string, string[]> = {}

	const alerts = (raw as ReportAlerts | undefined)?.alerts ?? []
	for (const alert of alerts) {
		if (alert.type !== 'blacklist-association') continue

		for (const assoc of alert.details?.associations ?? []) {
			const contextLines = (assoc.matches ?? []).map((match) => {
				const source = match.source ? match.source.replace(/-/g, ' ') : 'unknown'
				const detail = match.detail ? ` - ${match.detail}` : ''
				const occurredAt = match.occurredAt ? ` (${match.occurredAt})` : ''
				return `${source}${detail}${occurredAt}`
			})

			if (assoc.characterId) {
				const id = String(assoc.characterId)
				ids.add(id)
				contextsById[id] = [...new Set([...(contextsById[id] ?? []), ...contextLines])]
			}
			if (assoc.characterName) {
				const normalizedName = assoc.characterName.trim().toLowerCase()
				names.add(normalizedName)
				contextsByName[normalizedName] = [
					...new Set([...(contextsByName[normalizedName] ?? []), ...contextLines]),
				]
			}
		}
	}

	return { ids, names, contextsById, contextsByName }
}

export function isBlacklistedEntity(
	value: string | number | null | undefined,
	blacklist: BlacklistHighlights,
): boolean {
	if (value == null) return false
	const normalized = String(value).trim()
	if (!normalized) return false
	return blacklist.ids.has(normalized) || blacklist.names.has(normalized.toLowerCase())
}

export function getBlacklistContext(
	value: string | number | null | undefined,
	blacklist: BlacklistHighlights,
): string[] {
	if (value == null) return []
	const normalized = String(value).trim()
	if (!normalized) return []
	return blacklist.contextsById[normalized] ?? blacklist.contextsByName[normalized.toLowerCase()] ?? []
}

function renderContextLine(context: string): ReactNode {
	return renderBlacklistContextLine(context)
}

export function BlacklistHighlight({
	value,
	blacklist,
	children,
	className,
}: {
	value: string | number | null | undefined
	blacklist?: BlacklistHighlights
	children: ReactNode
	className?: string
}) {
	if (!blacklist || !isBlacklistedEntity(value, blacklist)) {
		return children
	}

	const contexts = getBlacklistContext(value, blacklist)

	return (
		<HoverPopover
			trigger={<span className={cn('cursor-help text-destructive font-semibold', className)}>{children}</span>}
			side="top"
			align="start"
			className="max-w-sm border border-border bg-popover p-3 text-popover-foreground shadow-lg"
		>
			<div className="space-y-2 text-xs">
				<div className="font-semibold uppercase tracking-wide text-muted-foreground">
					Blocklist context
				</div>
				{contexts.length > 0 ? (
					<ul className="space-y-1">
						{contexts.map((context, index) => (
							<li key={`${String(value)}:${index}`} className="break-words">
								{renderContextLine(context)}
							</li>
						))}
					</ul>
				) : (
					<p>No additional context available.</p>
				)}
			</div>
		</HoverPopover>
	)
}
