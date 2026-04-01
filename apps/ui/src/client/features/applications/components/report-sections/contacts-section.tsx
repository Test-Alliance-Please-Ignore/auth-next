/**
 * Contacts Section - Searchable, filterable table with EVE standing colors
 */

import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

interface ProcessedContact {
	contact_id: number
	contactName?: string
	contact_type?: string
	standing?: number
	standingFormatted?: string
}

type ContactTypeFilter = 'all' | 'character' | 'corporation' | 'alliance' | 'faction'
type StandingFilter = 'all' | 'excellent' | 'good' | 'neutral' | 'bad' | 'terrible'

const DEFAULT_VISIBLE = 50

// EVE Online standing colors
function standingColor(standing?: number): string {
	if (standing == null || standing === 0) return 'text-muted-foreground' // neutral grey
	if (standing >= 5) return 'text-[#2b6cb0]' // dark blue — excellent
	if (standing > 0) return 'text-[#4a9ede]' // light blue — good
	if (standing <= -5) return 'text-[#9b2c2c]' // dark red — terrible
	return 'text-[#c05621]' // orange — bad
}

function standingLabel(standing?: number): string {
	if (standing == null) return '0.0'
	const prefix = standing > 0 ? '+' : ''
	return `${prefix}${standing.toFixed(1)}`
}

function matchesStandingFilter(standing: number | undefined, filter: StandingFilter): boolean {
	if (filter === 'all') return true
	const s = standing ?? 0
	switch (filter) {
		case 'excellent':
			return s >= 5
		case 'good':
			return s > 0 && s < 5
		case 'neutral':
			return s === 0
		case 'bad':
			return s < 0 && s > -5
		case 'terrible':
			return s <= -5
	}
}

function FilterButton({
	active,
	onClick,
	children,
	count,
}: {
	active: boolean
	onClick: () => void
	children: React.ReactNode
	count?: number
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
				active
					? 'bg-primary text-primary-foreground'
					: 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
			)}
		>
			{children}
			{count != null && <span className="ml-1 opacity-70">({count})</span>}
		</button>
	)
}

export function ContactsSection({ data }: { data: ProcessedContact[] }) {
	const [search, setSearch] = useState('')
	const [typeFilter, setTypeFilter] = useState<ContactTypeFilter>('all')
	const [standingFilter, setStandingFilter] = useState<StandingFilter>('all')
	const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE)

	const typeCounts = useMemo(() => {
		const counts: Record<string, number> = {}
		for (const c of data) {
			const t = c.contact_type || 'unknown'
			counts[t] = (counts[t] ?? 0) + 1
		}
		return counts
	}, [data])

	const filtered = useMemo(() => {
		let result = data

		if (typeFilter !== 'all') {
			result = result.filter((c) => c.contact_type === typeFilter)
		}

		if (standingFilter !== 'all') {
			result = result.filter((c) => matchesStandingFilter(c.standing, standingFilter))
		}

		if (search.trim()) {
			const q = search.toLowerCase()
			result = result.filter(
				(c) =>
					c.contactName?.toLowerCase().includes(q) ||
					c.contact_type?.toLowerCase().includes(q),
			)
		}

		return result
	}, [data, typeFilter, standingFilter, search])

	const visible = filtered.slice(0, visibleCount)
	const hasMore = visibleCount < filtered.length

	if (data.length === 0) {
		return <p className="text-sm text-muted-foreground">No contacts found.</p>
	}

	return (
		<div className="space-y-4">
			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3">
				{/* Type filter */}
				<div className="flex flex-wrap gap-1">
					<FilterButton
						active={typeFilter === 'all'}
						onClick={() => setTypeFilter('all')}
						count={data.length}
					>
						All
					</FilterButton>
					{(['character', 'corporation', 'alliance', 'faction'] as const).map(
						(type) =>
							typeCounts[type] && (
								<FilterButton
									key={type}
									active={typeFilter === type}
									onClick={() => setTypeFilter(typeFilter === type ? 'all' : type)}
									count={typeCounts[type]}
								>
									<span className="capitalize">{type}</span>
								</FilterButton>
							),
					)}
				</div>

				<div className="h-5 w-px bg-border" />

				{/* Standing filter */}
				<div className="flex flex-wrap gap-1">
					{(
						[
							['all', 'Any Standing'],
							['excellent', '+10 to +5'],
							['good', '+5 to 0'],
							['neutral', 'Neutral'],
							['bad', '0 to -5'],
							['terrible', '-5 to -10'],
						] as const
					).map(([key, label]) => (
						<FilterButton
							key={key}
							active={standingFilter === key}
							onClick={() => setStandingFilter(standingFilter === key ? 'all' : key)}
						>
							{label}
						</FilterButton>
					))}
				</div>

				<div className="ml-auto w-56">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search contacts..."
							value={search}
							onChange={(e) => {
								setSearch(e.target.value)
								setVisibleCount(DEFAULT_VISIBLE)
							}}
							className="h-8 pl-8 text-sm"
						/>
					</div>
				</div>
			</div>

			{/* Results */}
			<p className="text-sm text-muted-foreground">
				{filtered.length} contact{filtered.length !== 1 ? 's' : ''}
				{search || typeFilter !== 'all' || standingFilter !== 'all'
					? ` (of ${data.length})`
					: ''}
			</p>

			{filtered.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					No contacts match the current filters
				</p>
			) : (
				<div className="max-h-[700px] overflow-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/50">
								<TableHead className="font-semibold">Name</TableHead>
								<TableHead className="font-semibold">Type</TableHead>
								<TableHead className="text-right font-semibold">Standing</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visible.map((contact) => (
								<TableRow key={contact.contact_id}>
									<TableCell className="font-medium">
										{contact.contactName || `ID: ${contact.contact_id}`}
									</TableCell>
									<TableCell className="text-sm capitalize text-muted-foreground">
										{contact.contact_type?.replace('_', ' ') || '-'}
									</TableCell>
									<TableCell className="text-right">
										<span
											className={cn(
												'font-mono text-sm font-semibold',
												standingColor(contact.standing),
											)}
										>
											{standingLabel(contact.standing)}
										</span>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{hasMore && (
				<div className="flex items-center justify-center gap-3">
					<Button
						variant="outline"
						size="sm"
						onClick={() => setVisibleCount((c) => c + DEFAULT_VISIBLE)}
					>
						Show more
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setVisibleCount(filtered.length)}
					>
						Show all ({filtered.length})
					</Button>
				</div>
			)}
		</div>
	)
}
