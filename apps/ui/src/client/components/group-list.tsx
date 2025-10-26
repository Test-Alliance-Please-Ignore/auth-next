import { Eye, UserPlus, Users } from 'lucide-react'
import { memo, useCallback } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { useJoinGroup } from '@/hooks/useGroups'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'

import { JoinModeBadge } from './join-mode-badge'
import { VisibilityBadge } from './visibility-badge'

import type { GroupWithDetails } from '@/lib/api'

interface GroupListProps {
	groups: GroupWithDetails[]
	isLoading?: boolean
	isAdminContext?: boolean
}

// Memoized row component to prevent unnecessary re-renders
const GroupRow = memo(
	({
		group,
		onJoin,
		isJoining,
		isAdminContext,
	}: {
		group: GroupWithDetails
		onJoin: (groupId: string, groupName: string) => void
		isJoining: boolean
		isAdminContext?: boolean
	}) => {
		const handleJoinClick = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation()
				onJoin(group.id, group.name)
			},
			[group.id, group.name, onJoin]
		)

		const groupDetailUrl = isAdminContext ? `/admin/groups/${group.id}` : `/groups/${group.id}`

		return (
			<TableRow key={group.id} className={cn(group.visibility === 'system' && 'bg-destructive/5')}>
				<TableCell className="font-medium">
					<div className="flex items-center gap-2">
						<Link to={groupDetailUrl} className="hover:underline">
							{group.name}
						</Link>
						{group.visibility === 'system' && (
							<span className="text-xs text-destructive" title="System visibility group">
								⚠️
							</span>
						)}
					</div>
				</TableCell>
				<TableCell>
					<span className="text-sm text-muted-foreground">{group.category.name}</span>
				</TableCell>
				<TableCell>
					<VisibilityBadge visibility={group.visibility} />
				</TableCell>
				<TableCell>
					<JoinModeBadge joinMode={group.joinMode} />
				</TableCell>
				<TableCell>
					<span className="text-sm">{group.memberCount || 0}</span>
				</TableCell>
				<TableCell className="text-right">
					<div className="flex items-center justify-end gap-2">
						{group.joinMode === 'open' && !group.isMember && (
							<Button variant="default" size="sm" disabled={isJoining} onClick={handleJoinClick}>
								<UserPlus className="mr-2 h-4 w-4" />
								{isJoining ? 'Joining...' : 'Quick Join'}
							</Button>
						)}
						<Button variant="ghost" size="sm" asChild>
							<Link to={groupDetailUrl}>
								<Eye className="mr-2 h-4 w-4" />
								View Details
							</Link>
						</Button>
					</div>
				</TableCell>
			</TableRow>
		)
	}
)

GroupRow.displayName = 'GroupRow'

export const GroupList = memo(function GroupList({
	groups,
	isLoading,
	isAdminContext,
}: GroupListProps) {
	const isMobile = useMediaQuery('(max-width: 768px)')
	const joinGroup = useJoinGroup()

	// Memoize the join handler to prevent recreating on every render
	const handleJoinGroup = useCallback(
		(groupId: string, groupName: string) => {
			joinGroup.mutate(groupId, {
				onSuccess: () => {
					alert(`Successfully joined ${groupName}!`)
				},
				onError: (error: Error) => {
					alert(`Failed to join: ${error.message}`)
				},
			})
		},
		[joinGroup]
	)

	if (isLoading) {
		return (
			<div className="space-y-4">
				{[...Array(5)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
				))}
			</div>
		)
	}

	if (groups.length === 0) {
		return (
			<Card variant="interactive">
				<CardContent className="py-12 text-center">
					<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
						<Users className="h-8 w-8 text-muted-foreground" />
					</div>
					<h3 className="text-xl font-semibold mb-2">No Groups Found</h3>
					<p className="text-muted-foreground max-w-md mx-auto">
						No groups match your current filter criteria. Try adjusting your filters or browse all
						available groups.
					</p>
				</CardContent>
			</Card>
		)
	}

	// Mobile card view
	if (isMobile) {
		return (
			<div className="space-y-3">
				{groups.map((group) => {
					const groupDetailUrl = isAdminContext
						? `/admin/groups/${group.id}`
						: `/groups/${group.id}`
					return (
						<Card
							key={group.id}
							className={cn(
								'hover:border-primary/30 transition-colors',
								group.visibility === 'system' && 'border-destructive/30 bg-destructive/5'
							)}
						>
							<CardContent className="p-3">
								<div className="space-y-2">
									<div className="flex items-start justify-between gap-2">
										<div className="flex-1 min-w-0">
											<h4 className="font-semibold text-lg truncate flex items-center gap-2">
												<Link to={groupDetailUrl} className="hover:underline">
													{group.name}
												</Link>
												{group.visibility === 'system' && (
													<span
														className="text-xs text-destructive"
														title="System visibility group"
													>
														⚠️
													</span>
												)}
											</h4>
											<p className="text-sm text-muted-foreground">{group.category.name}</p>
										</div>
									</div>

									<div className="flex flex-wrap gap-2">
										<VisibilityBadge visibility={group.visibility} />
										<JoinModeBadge joinMode={group.joinMode} />
									</div>

									<div className="flex items-center justify-between pt-2 border-t border-border/50">
										<span className="text-sm text-muted-foreground">
											{group.memberCount || 0} members
										</span>
										{group.joinMode === 'open' && !group.isMember ? (
											<Button
												variant="default"
												size="sm"
												disabled={joinGroup.isPending}
												onClick={(e) => {
													e.stopPropagation()
													joinGroup.mutate(group.id, {
														onSuccess: () => {
															alert(`Successfully joined ${group.name}!`)
														},
														onError: (error: Error) => {
															alert(`Failed to join: ${error.message}`)
														},
													})
												}}
											>
												<UserPlus className="mr-2 h-4 w-4" />
												{joinGroup.isPending ? 'Joining...' : 'Quick Join'}
											</Button>
										) : (
											<Button variant="outline" size="sm" asChild>
												<Link to={groupDetailUrl}>
													<Eye className="mr-2 h-4 w-4" />
													View Details
												</Link>
											</Button>
										)}
									</div>
								</div>
							</CardContent>
						</Card>
					)
				})}
			</div>
		)
	}

	// Desktop table view
	return (
		<div className="rounded-md border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Group Name</TableHead>
						<TableHead>Category</TableHead>
						<TableHead>Visibility</TableHead>
						<TableHead>Join Mode</TableHead>
						<TableHead>Members</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{groups.map((group) => (
						<GroupRow
							key={group.id}
							group={group}
							onJoin={handleJoinGroup}
							isJoining={joinGroup.isPending}
							isAdminContext={isAdminContext}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	)
})
