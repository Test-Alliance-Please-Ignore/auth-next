import { useState } from 'react'
import { Check, Copy, UserCog, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { JoinModeBadge } from './join-mode-badge'
import { VisibilityBadge } from './visibility-badge'

import type { GroupWithDetails } from '@/lib/api'

interface GroupCardProps {
	group: GroupWithDetails
}

export function GroupCard({ group }: GroupCardProps) {
	const [copiedId, setCopiedId] = useState(false)

	const handleCopyId = async () => {
		try {
			await navigator.clipboard.writeText(group.id)
			setCopiedId(true)
			setTimeout(() => setCopiedId(false), 2000)
		} catch (error) {
			console.error('Failed to copy group ID:', error)
		}
	}

	return (
		<Card variant="interactive">
			<CardHeader>
				<div className="flex items-start justify-between">
					<div className="space-y-1">
						<CardTitle className="text-2xl gradient-text">{group.name}</CardTitle>
						<CardDescription>{group.category.name}</CardDescription>
					</div>
					<div className="flex gap-2 items-center">
						<VisibilityBadge visibility={group.visibility} />
						<JoinModeBadge joinMode={group.joinMode} />
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
							onClick={handleCopyId}
							title={copiedId ? 'Copied!' : 'Copy Group ID'}
						>
							{copiedId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{group.description && <p className="text-sm text-muted-foreground">{group.description}</p>}

				<div className="flex gap-6 text-sm">
					<div className="flex items-center gap-2">
						<Users className="h-4 w-4 text-muted-foreground" />
						<span>
							<span className="font-medium">{group.memberCount || 0}</span> members
						</span>
					</div>
					<div className="flex items-center gap-2">
						<UserCog className="h-4 w-4 text-muted-foreground" />
						<span className="text-muted-foreground">Owner: {group.ownerName || group.ownerId}</span>
					</div>
				</div>

				{group.visibility === 'system' && (
					<div className="rounded-md border border-destructive bg-destructive/10 p-3">
						<p className="text-sm text-destructive font-medium">⚠️ System Visibility Group</p>
						<p className="text-xs text-destructive/80 mt-1">
							This group is only visible to system administrators and group owners/admins. Regular
							members cannot see this group or that they are members of it.
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
