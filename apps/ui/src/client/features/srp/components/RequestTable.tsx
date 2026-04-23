import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'

import { formatISK, formatRelativeTime } from '../utils'
import { getRequestCharacterRole } from '../utils'
import { CharacterRoleBadge } from './CharacterRoleBadge'
import { RequestStatusBadge } from './RequestStatusBadge'

import type { SRPRequestResponse } from '../types'

interface RequestTableProps {
	requests: SRPRequestResponse[]
	isLoading?: boolean
	showPagination?: boolean
}

export function RequestTable({ requests, isLoading }: RequestTableProps) {
	if (isLoading) {
		return (
			<div className="space-y-4">
				{[...Array(5)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
				))}
			</div>
		)
	}

	if (requests.length === 0) {
		return (
			<div className="rounded-lg border border-dashed p-8 text-center">
				<p className="text-sm text-muted-foreground">No requests found.</p>
			</div>
		)
	}

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Ship</TableHead>
						<TableHead>Character</TableHead>
						<TableHead>Date</TableHead>
						<TableHead className="text-right">Approved</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{requests.map((request) => (
						<TableRow key={request.id}>
							<TableCell className="font-semibold">{request.shipTypeName}</TableCell>
							<TableCell className="text-sm font-medium">
								<div className="inline-flex items-center gap-2">
									<span>{request.characterName}</span>
									<CharacterRoleBadge role={getRequestCharacterRole(request)} />
								</div>
							</TableCell>
							<TableCell className="text-sm text-muted-foreground">
								{formatRelativeTime(request.createdAt)}
							</TableCell>
							<TableCell className="text-right font-mono text-sm tabular-nums">
								{request.approvedAmount ? formatISK(request.approvedAmount) : '—'}
							</TableCell>
							<TableCell>
								<RequestStatusBadge status={request.requestStatus} />
							</TableCell>
							<TableCell className="text-right">
								<Button variant="secondary" size="sm" asChild>
									<Link to={`/srp/request/${request.id}`}>View</Link>
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}
