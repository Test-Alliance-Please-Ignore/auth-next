import { Calendar, Crown, Shield } from 'lucide-react'
import { Link } from 'react-router'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatDate, useAppTranslation } from '@/i18n'

import { LeaveButton } from './leave-button'

import type { GroupMembershipSummary } from '@/lib/api'

interface MyGroupsTableProps {
	title: string
	description: string
	memberships: GroupMembershipSummary[]
	showActions?: boolean
}

export function MyGroupsTable({
	title,
	description,
	memberships,
	showActions = true,
}: MyGroupsTableProps) {
	const { t } = useAppTranslation()

	return (
		<Card variant="default">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="p-0">
				<div className="rounded-md border-t">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t('myGroups.table.group')}</TableHead>
								<TableHead>{t('myGroups.table.category')}</TableHead>
								<TableHead>{t('myGroups.table.role')}</TableHead>
								<TableHead>{t('myGroups.table.joined')}</TableHead>
								<TableHead>{t('myGroups.table.mumble')}</TableHead>
								{showActions && (
									<TableHead className="text-right">{t('myGroups.table.actions')}</TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{memberships.map((membership) => {
								const joinedDate = formatDate(membership.joinedAt)
								const leaveGroup = {
									id: membership.groupId,
									name: membership.groupName,
									isMember: true,
									isOwner: membership.isOwner,
									joinMode: membership.joinMode ?? 'open',
								}

								return (
									<TableRow key={membership.groupId}>
										<TableCell className="font-medium">
											<Link to={`/groups/${membership.groupId}`} className="hover:underline">
												{membership.groupName}
											</Link>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{membership.categoryName}
										</TableCell>
										<TableCell>
											{membership.isOwner ? (
												<Badge variant="default" className="gap-1">
													<Crown className="h-3 w-3" />
													{t('myGroups.table.owner')}
												</Badge>
											) : membership.isAdmin ? (
												<Badge variant="secondary" className="gap-1">
													<Shield className="h-3 w-3" />
													{t('myGroups.table.admin')}
												</Badge>
											) : (
												<span className="text-muted-foreground">{t('myGroups.table.member')}</span>
											)}
										</TableCell>
										<TableCell className="whitespace-nowrap text-muted-foreground">
											<div className="flex items-center gap-2">
												<Calendar className="h-4 w-4" />
												<span>{joinedDate}</span>
											</div>
										</TableCell>
										<TableCell>
											{membership.mumbleSyncEnabled ? (
												<Badge variant="secondary">
													{membership.mumbleTicker ? `Mumble ${membership.mumbleTicker}` : 'Mumble'}
												</Badge>
											) : (
												<span className="text-muted-foreground">
													{t('myGroups.table.disabled')}
												</span>
											)}
										</TableCell>
										{showActions && (
											<TableCell className="text-right">
												<div className="flex justify-end">
													<LeaveButton group={leaveGroup} compact />
												</div>
											</TableCell>
										)}
									</TableRow>
								)
							})}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	)
}
