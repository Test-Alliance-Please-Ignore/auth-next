import { Link } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
			<div className="rounded-md border border-dashed p-8 text-center">
				<p className="text-muted-foreground">No groups found matching your criteria.</p>
			</div>
		)
	}

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
