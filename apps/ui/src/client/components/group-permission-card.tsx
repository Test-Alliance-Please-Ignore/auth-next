import { Edit2, Globe, Trash2 } from 'lucide-react'

import { PermissionTargetBadge } from '@/components/permission-target-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DestructiveButton } from '@/components/ui/destructive-button'

import type { GroupPermissionWithDetails } from '@/lib/api'

interface GroupPermissionCardProps {
	permission: GroupPermissionWithDetails
	onEdit?: (permission: GroupPermissionWithDetails) => void
	onRemove?: (permission: GroupPermissionWithDetails) => void
	showActions?: boolean
}

export function GroupPermissionCard({
	permission,
	onEdit,
	onRemove,
	showActions = true,
}: GroupPermissionCardProps) {
	const isGlobalPermission = !!permission.permission
	const isCustomPermission = !!permission.customUrn

	// Resolve display values
	const urn = isGlobalPermission ? permission.permission?.urn : permission.customUrn
	const name = isGlobalPermission ? permission.permission?.name : permission.customName
	const description = isGlobalPermission
		? permission.permission?.description
		: permission.customDescription

	return (
		<Card className="p-4 hover:bg-accent/50 transition-colors">
			<div className="flex items-start justify-between gap-4">
				<div className="flex-1 space-y-2">
					{/* Header */}
					<div className="flex items-center gap-2 flex-wrap">
						<h4 className="font-medium">{name}</h4>
						<PermissionTargetBadge target={permission.targetType} size="sm" />
						{isGlobalPermission && (
							<Badge variant="outline" className="text-xs gap-1">
								<Globe className="w-3 h-3" />
								Global
							</Badge>
						)}
						{isCustomPermission && (
							<Badge variant="secondary" className="text-xs">
								Custom
							</Badge>
						)}
						{isGlobalPermission && permission.permission?.category && (
							<Badge variant="secondary" className="text-xs">
								{permission.permission.category.name}
							</Badge>
						)}
					</div>

					{/* URN */}
					<p className="font-mono text-xs text-muted-foreground">{urn}</p>

					{/* Description */}
					{description && <p className="text-sm text-muted-foreground">{description}</p>}

					{/* Metadata */}
					<div className="flex gap-3 text-xs text-muted-foreground">
						<span>
							Created: {new Date(permission.createdAt).toLocaleDateString()}
						</span>
						<span>•</span>
						<span>
							By: {permission.createdBy}
						</span>
					</div>
				</div>

				{/* Actions */}
				{showActions && (
					<div className="flex items-center gap-2">
						{onEdit && (
							<Button variant="ghost" size="sm" onClick={() => onEdit(permission)}>
								<Edit2 className="h-4 w-4" />
							</Button>
						)}
						{onRemove && (
							<DestructiveButton size="sm" onClick={() => onRemove(permission)}>
								<Trash2 className="h-4 w-4" />
							</DestructiveButton>
						)}
					</div>
				)}
			</div>
		</Card>
	)
}
