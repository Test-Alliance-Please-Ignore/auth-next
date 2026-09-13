import { ExternalLink, Users } from 'lucide-react'
import { Link } from 'react-router'

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
import { formatNumber, useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t('admin.permissionUsage.title')}</DialogTitle>
					<DialogDescription>
						{t('admin.permissionUsage.description', { name: permissionName })}
						<span className="block font-mono text-xs mt-1">{permissionUrn}</span>
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 mt-4">
					{groupPermissions.length === 0 && (
						<Card className="p-8 text-center">
							<Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
							<h3 className="text-lg font-medium mb-2">{t('admin.permissionUsage.empty')}</h3>
							<p className="text-muted-foreground">{t('admin.permissionUsage.emptyDescription')}</p>
						</Card>
					)}

					{groupPermissions.length > 0 && (
						<>
							<div className="flex items-center justify-between">
								<p className="text-sm text-muted-foreground">
									{t('admin.permissionUsage.count', {
										count: groupPermissions.length,
										value: formatNumber(groupPermissions.length),
									})}
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
											<Link to={`/admin/groups/${gp.group.id}`}>
												<Button variant="ghost" size="sm">
													{t('admin.permissionUsage.viewGroup')}
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
