import { ExternalLink, Users } from 'lucide-react'
import { Link } from 'react-router-dom'

import { PermissionTargetBadge } from '@/components/permission-target-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

import type { GroupPermissionWithDetails } from '@/lib/api'

interface PermissionUsageDialogProps {
	permissionName: string
	permissionUrn: string
	groupPermissions: GroupPermissionWithDetails[]
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function PermissionUsageDialog({
	permissionName,
	permissionUrn,
	groupPermissions,
	open,
	onOpenChange,
}: PermissionUsageDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Permission Usage</DialogTitle>
					<DialogDescription>
						Groups using the permission "{permissionName}"
						<span className="block font-mono text-xs mt-1">{permissionUrn}</span>
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 mt-4">
					{groupPermissions.length === 0 && (
						<Card className="p-8 text-center">
							<Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
							<h3 className="text-lg font-medium mb-2">No groups using this permission</h3>
							<p className="text-muted-foreground">
								This permission is not currently attached to any groups
							</p>
						</Card>
					)}

					{groupPermissions.length > 0 && (
						<>
							<div className="flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									Used by {groupPermissions.length} group{groupPermissions.length !== 1 ? 's' : ''}
								</p>
							</div>

							<div className="space-y-2">
								{groupPermissions.map((gp) => (
									<Card key={gp.id} className="p-4 hover:bg-accent/50 transition-colors">
										<div className="flex items-start justify-between gap-4">
											<div className="flex-1 space-y-2">
												<div className="flex items-center gap-2">
													<h4 className="font-medium">{gp.group.name}</h4>
													<PermissionTargetBadge target={gp.targetType} size="sm" />
												</div>
											</div>
											<Link to={`/admin/group-detail/${gp.group.id}`}>
												<Button variant="ghost" size="sm">
													View Group
													<ExternalLink className="w-3 h-3 ml-2" />
												</Button>
											</Link>
										</div>
									</Card>
								))}
							</div>
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
