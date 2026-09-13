import { ExternalLink, Users } from 'lucide-react'
import { memo } from 'react'
import { Link } from 'react-router'

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
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useAppTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

import { GroupMembershipAction } from './group-membership-action'
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
	({ group, isAdminContext }: { group: GroupWithDetails; isAdminContext?: boolean }) => {
		const { t } = useAppTranslation()
		const groupDetailUrl = isAdminContext ? `/admin/groups/${group.id}` : `/groups/${group.id}`

		return (
			<TableRow key={group.id} className={cn(group.visibility === 'system' && 'bg-destructive/5')}>
				<TableCell className="font-medium">
					<div className="flex items-center gap-2">
						<Link to={groupDetailUrl} className="hover:underline">
							{group.name}
						</Link>
						{group.visibility === 'system' && (
							<span className="text-xs text-destructive" title={t('groups.systemVisibility')}>
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
				<TableCell className="text-right">
					<div className="flex items-center justify-end gap-2">
						<GroupMembershipAction group={group} />
						<Button variant="ghost" size="sm" asChild title={t('groups.viewDetails')}>
							<Link to={groupDetailUrl}>
								<ExternalLink className="h-4 w-4" />
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
	const { t } = useAppTranslation()
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
			<Card>
				<CardContent className="py-12 text-center">
					<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
						<Users className="h-8 w-8 text-muted-foreground" />
					</div>
					<h3 className="text-xl font-semibold mb-2">{t('groups.noGroups')}</h3>
					<p className="text-muted-foreground max-w-md mx-auto">
						{t('groups.noGroupsDescription')}
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
														title={t('groups.systemVisibility')}
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

									<div className="flex items-center justify-end gap-2 border-t border-border/50 pt-2">
										<GroupMembershipAction group={group} />
										<Button variant="ghost" size="sm" asChild title={t('groups.viewDetails')}>
											<Link to={groupDetailUrl}>
												<ExternalLink className="h-4 w-4" />
											</Link>
										</Button>
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
						<TableHead>{t('groups.groupName')}</TableHead>
						<TableHead>{t('groups.category')}</TableHead>
						<TableHead>{t('groups.visibility')}</TableHead>
						<TableHead>{t('groups.joinMode')}</TableHead>
						<TableHead className="text-right">{t('groups.actions')}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{groups.map((group) => (
						<GroupRow key={group.id} group={group} isAdminContext={isAdminContext} />
					))}
				</TableBody>
			</Table>
		</div>
	)
})
