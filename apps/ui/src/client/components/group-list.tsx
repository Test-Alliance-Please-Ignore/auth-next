import { Link } from 'react-router-dom'
import { Eye, Users } from 'lucide-react'

import { useMediaQuery } from '@/hooks/useMediaQuery'
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
import { VisibilityBadge } from './visibility-badge'
import { JoinModeBadge } from './join-mode-badge'
import { cn } from '@/lib/utils'

import type { GroupWithDetails } from '@/lib/api'

interface GroupListProps {
	groups: GroupWithDetails[]
	isLoading?: boolean
}

export function GroupList({ groups, isLoading }: GroupListProps) {
	const isMobile = useMediaQuery('(max-width: 768px)')

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
			<Card className="glow">
				<CardContent className="py-16 text-center">
					<div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
						<Users className="h-10 w-10 text-muted-foreground" />
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
			<div className="space-y-4">
				{groups.map((group) => (
					<Card
						key={group.id}
						className={cn(
							'hover:border-primary/30 transition-colors',
							group.visibility === 'system' && 'border-destructive/30 bg-destructive/5'
						)}
					>
						<CardContent className="p-4">
							<div className="space-y-3">
								<div className="flex items-start justify-between gap-2">
									<div className="flex-1 min-w-0">
										<h4 className="font-semibold text-lg truncate flex items-center gap-2">
											{group.name}
											{group.visibility === 'system' && (
												<span className="text-xs text-destructive" title="System visibility group">
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
									<Button variant="outline" size="sm" asChild>
										<Link to={`/admin/groups/${group.id}`}>
											<Eye className="mr-2 h-4 w-4" />
											View Details
										</Link>
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>
				))}
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
						<TableRow
							key={group.id}
							className={cn(group.visibility === 'system' && 'bg-destructive/5')}
						>
							<TableCell className="font-medium">
								<div className="flex items-center gap-2">
									{group.name}
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
								<Button variant="ghost" size="sm" asChild>
									<Link to={`/admin/groups/${group.id}`}>
										<Eye className="mr-2 h-4 w-4" />
										View Details
									</Link>
								</Button>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}
