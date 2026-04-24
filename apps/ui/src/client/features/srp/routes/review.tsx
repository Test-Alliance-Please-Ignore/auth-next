import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Card, CardContent } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { EveTimeDisplay } from '@/components/ui/eve-time-display'
import { PageHeader } from '@/components/ui/page-header'
import { Select } from '@/components/ui/select'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserPermissions } from '@/hooks/useUserPermissions'
import { api } from '@/lib/api'
import { typeIconUrl } from '@/lib/eve-images'

import { RequestStatusBadge } from '../components/RequestStatusBadge'
import { CharacterRoleBadge } from '../components/CharacterRoleBadge'
import { useRequestsByStatus } from '../hooks'
import { formatISK, formatRelativeTime, getRequestCharacterRole } from '../utils'

import type { RequestStatus, SRPRequestResponse } from '../types'

const TABS: Array<{ value: RequestStatus; label: string }> = [
	{ value: 'pending', label: 'Pending' },
	{ value: 'needs_context', label: 'Needs Context' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'paid', label: 'Paid' },
]

type ReviewQueueFilters = {
	characterName?: string
	shipTypeName?: string
	solarSystemName?: string
	dateFrom?: string
	dateTo?: string
}

export default function ReviewQueue() {
	const { hasPermission, isAdmin } = useUserPermissions()
	const [activeTab, setActiveTab] = useState<RequestStatus>('pending')
	const [filters, setFilters] = useState<ReviewQueueFilters>({})

	const canAccessReviewQueue =
		isAdmin ||
		hasPermission('urn:srp:reviewer') ||
		hasPermission('urn:srp:payer') ||
		hasPermission('urn:srp:manager')

	if (!canAccessReviewQueue) {
		return <Navigate to="/srp" replace />
	}

	return (
		<Container>
			<PageHeader title="Review Queue" description="Review and process ship replacement requests" />

			<Card className="mt-section">
				<CardContent className="space-y-4 p-4">
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<Select
							options={[]}
							value={filters.characterName ?? ''}
							onValueChange={(value) =>
								setFilters((prev) => ({
									...prev,
									characterName: value || undefined,
								}))
							}
							searchable
							searchDelegate={async (query) => {
								const values = await api.getSrpReviewSearchValues({
									status: activeTab,
									field: 'character',
									query,
								})

								return values.map((entry) => ({
									value: entry.value,
									label: entry.value,
								}))
							}}
							placeholder="Character"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No character names found"
							selectAllOption={{ value: '', label: 'All Characters' }}
						/>
						<Select
							options={[]}
							value={filters.shipTypeName ?? ''}
							onValueChange={(value) =>
								setFilters((prev) => ({
									...prev,
									shipTypeName: value || undefined,
								}))
							}
							searchable
							searchDelegate={async (query) => {
								const values = await api.getSrpReviewSearchValues({
									status: activeTab,
									field: 'ship',
									query,
								})

								return values.map((entry) => ({
									value: entry.value,
									label: entry.value,
								}))
							}}
							placeholder="Ship"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No ships found"
							selectAllOption={{ value: '', label: 'All Ships' }}
						/>
						<Select
							options={[]}
							value={filters.solarSystemName ?? ''}
							onValueChange={(value) =>
								setFilters((prev) => ({
									...prev,
									solarSystemName: value || undefined,
								}))
							}
							searchable
							searchDelegate={async (query) => {
								const values = await api.getSrpReviewSearchValues({
									status: activeTab,
									field: 'system',
									query,
								})

								return values.map((entry) => ({
									value: entry.value,
									label: entry.value,
								}))
							}}
							placeholder="System"
							minQueryLength={2}
							queryHintText="Type at least 2 characters"
							emptyText="No systems found"
							selectAllOption={{ value: '', label: 'All Systems' }}
						/>
						<DateRangeInput
							value={{
								fromDate: filters.dateFrom ?? '',
								toDate: filters.dateTo ?? '',
							}}
							onChange={({ fromDate, toDate }) =>
								setFilters((prev) => ({
									...prev,
									dateFrom: fromDate || undefined,
									dateTo: toDate || undefined,
								}))
							}
							placeholder="Loss date range"
							className="[&_.themed-date-picker__input]:h-10"
						/>
					</div>

					<Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as RequestStatus)}>
						<TabsList className="w-full">
							{TABS.map((tab) => (
								<TabsTrigger key={tab.value} value={tab.value}>
									{tab.label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>

					<ReviewTabContent status={activeTab} filters={filters} />
				</CardContent>
			</Card>
		</Container>
	)
}

function ReviewTabContent({ status, filters }: { status: RequestStatus; filters: ReviewQueueFilters }) {
	const { data, isLoading, error } = useRequestsByStatus(status, { limit: 50, ...filters })
	const hasActiveFilters = Boolean(
		filters.characterName ||
			filters.shipTypeName ||
			filters.solarSystemName ||
			filters.dateFrom ||
			filters.dateTo
	)

	if (isLoading) {
		return (
			<div className="space-y-2">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted/30" />
				))}
			</div>
		)
	}

	if (error) {
		return (
			<div className="rounded-lg border border-red-500/50 bg-red-500/10 p-6 text-center">
				<p className="text-sm text-red-500">Failed to load requests</p>
			</div>
		)
	}

	const requests: SRPRequestResponse[] = data?.requests ?? []

	if (requests.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-12 text-center">
				<p className="text-muted-foreground">
					{hasActiveFilters
						? 'No requests match the current filters'
						: `No ${status.replace('_', ' ')} requests`}
				</p>
			</div>
		)
	}

	return (
		<div>
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-14" />
							<TableHead>Ship</TableHead>
							<TableHead>Pilot</TableHead>
							<TableHead className="text-right">Payout / Value</TableHead>
							<TableHead>System</TableHead>
							<TableHead>Lost</TableHead>
							<TableHead>Submitted</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{requests.map((req) => (
							<TableRow key={req.id}>
								<TableCell className="py-2">
									{req.shipTypeId && (
										<div className="h-10 w-10 overflow-hidden rounded border border-border/50">
											<img
												src={typeIconUrl(req.shipTypeId, 32)}
												alt={req.shipTypeName ?? ''}
												className="h-full w-full object-contain"
												loading="lazy"
											/>
										</div>
									)}
								</TableCell>
								<TableCell className="font-semibold">
									<Link
										to={`/srp/review/${req.id}`}
										className="underline-offset-4 hover:underline focus-visible:underline"
									>
										{req.shipTypeName ?? '—'}
									</Link>
								</TableCell>
								<TableCell className="text-sm">
									<div className="inline-flex items-center gap-2">
										<span>{req.characterName}</span>
										<CharacterRoleBadge role={getRequestCharacterRole(req)} />
									</div>
									{req.corporationName && req.corporationName !== 'Unknown' && (
										<div className="text-xs text-muted-foreground">{req.corporationName}</div>
									)}
								</TableCell>
								<TableCell className="text-right font-mono text-sm tabular-nums">
									{formatISK(req.approvedAmount ?? req.srpEquipmentValue ?? req.shipValue)}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{req.solarSystemName ?? '—'}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{req.lossDate ? (
										<EveTimeDisplay
											dateStr={req.lossDate}
											className="text-sm text-muted-foreground"
										/>
									) : (
										'—'
									)}
								</TableCell>
								<TableCell className="text-sm text-muted-foreground">
									{formatRelativeTime(req.createdAt)}
								</TableCell>
								<TableCell>
									<RequestStatusBadge status={req.requestStatus as any} />
								</TableCell>
								<TableCell className="text-right">
									<Button size="sm" variant="secondary" asChild>
										<Link to={`/srp/review/${req.id}`}>View</Link>
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{data && data.total > requests.length && (
				<p className="mt-2 text-center text-sm text-muted-foreground">
					Showing {requests.length} of {data.total}
				</p>
			)}
		</div>
	)
}
