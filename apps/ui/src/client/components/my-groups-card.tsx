import { Crown, Shield, Calendar } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

import type { GroupMembershipSummary } from '@/lib/api'

interface MyGroupsCardProps {
	membership: GroupMembershipSummary
	onClick?: () => void
}

export function MyGroupsCard({ membership, onClick }: MyGroupsCardProps) {
	const joinedDate = new Date(membership.joinedAt).toLocaleDateString()

	return (
		<Card variant="interactive" onClick={onClick}>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1 flex-1">
						<div className="flex items-center gap-2">
							<CardTitle className="text-xl gradient-text">{membership.groupName}</CardTitle>
							{membership.isOwner && (
								<Badge variant="default" className="gap-1">
									<Crown className="h-3 w-3" />
									Owner
								</Badge>
							)}
							{membership.isAdmin && !membership.isOwner && (
								<Badge variant="secondary" className="gap-1">
									<Shield className="h-3 w-3" />
									Admin
								</Badge>
							)}
						</div>
						<CardDescription>{membership.categoryName}</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Calendar className="h-4 w-4" />
					<span>Joined {joinedDate}</span>
				</div>
			</CardContent>
		</Card>
	)
}
