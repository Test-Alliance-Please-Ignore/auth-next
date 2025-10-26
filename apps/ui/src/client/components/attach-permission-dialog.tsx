import { Plus, Search } from 'lucide-react'
import { useState } from 'react'

import { PermissionTargetBadge } from '@/components/permission-target-badge'
import { Badge } from '@/components/ui/badge'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card } from '@/components/ui/card'
import { ConfirmButton } from '@/components/ui/confirm-button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useGlobalPermissions } from '@/hooks/usePermissions'
import { usePermissionCategories } from '@/hooks/usePermissionCategories'

import type { AttachPermissionRequest, PermissionTarget } from '@/lib/api'

interface AttachPermissionDialogProps {
	groupId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onSubmit: (data: AttachPermissionRequest) => Promise<void>
	isSubmitting?: boolean
}

export function AttachPermissionDialog({
	groupId,
	open,
	onOpenChange,
	onSubmit,
	isSubmitting,
}: AttachPermissionDialogProps) {
	const { data: permissions = [], isLoading } = useGlobalPermissions()
	const { data: categories = [] } = usePermissionCategories()

	const [selectedPermissionId, setSelectedPermissionId] = useState<string>('')
	const [targetType, setTargetType] = useState<PermissionTarget>('all_members')
	const [searchQuery, setSearchQuery] = useState('')
	const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!selectedPermissionId) return

		try {
			await onSubmit({
				groupId,
				permissionId: selectedPermissionId,
				targetType,
			})

			// Reset form
			setSelectedPermissionId('')
			setTargetType('all_members')
			setSearchQuery('')
			setCategoryFilter(undefined)
		} catch (error) {
			console.error('Failed to attach permission:', error)
		}
	}

	const handleCancel = () => {
		setSelectedPermissionId('')
		setTargetType('all_members')
		setSearchQuery('')
		setCategoryFilter(undefined)
		onOpenChange(false)
	}

	// Filter permissions
	const filteredPermissions = permissions.filter((p) => {
		const matchesSearch =
			!searchQuery ||
			p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			p.urn.toLowerCase().includes(searchQuery.toLowerCase())

		const matchesCategory =
			!categoryFilter ||
			categoryFilter === 'all' ||
			(categoryFilter === 'uncategorized' && !p.categoryId) ||
			p.categoryId === categoryFilter

		return matchesSearch && matchesCategory
	})

	const selectedPermission = permissions.find((p) => p.id === selectedPermissionId)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Attach Global Permission</DialogTitle>
					<DialogDescription>
						Select a global permission from the registry to attach to this group
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Filters */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div className="space-y-2">
							<Label htmlFor="search-permissions">Search</Label>
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
								<Input
									id="search-permissions"
									placeholder="Search by name or URN..."
									value={searchQuery}
									onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
									className="pl-9"
								/>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="category-filter-attach">Filter by Category</Label>
							<Select value={categoryFilter || 'all'} onValueChange={(value) => setCategoryFilter(value === 'all' ? undefined : value)}>
								<SelectTrigger id="category-filter-attach">
									<SelectValue placeholder="All categories" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All categories</SelectItem>
									<SelectItem value="uncategorized">Uncategorized</SelectItem>
									{categories.map((category) => (
										<SelectItem key={category.id} value={category.id}>
											{category.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Permission Selection */}
					<div className="space-y-2">
						<Label>
							Select Permission <span className="text-destructive">*</span>
						</Label>
						{isLoading ? (
							<div className="space-y-2">
								{[1, 2, 3].map((i) => (
									<div key={i} className="h-16 bg-muted animate-pulse rounded" />
								))}
							</div>
						) : filteredPermissions.length === 0 ? (
							<Card className="p-8 text-center">
								<p className="text-muted-foreground">
									{searchQuery || categoryFilter
										? 'No permissions match your search criteria'
										: 'No global permissions available'}
								</p>
							</Card>
						) : (
							<div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
								{filteredPermissions.map((permission) => (
									<Card
										key={permission.id}
										className={`p-3 cursor-pointer transition-colors ${
											selectedPermissionId === permission.id
												? 'border-primary bg-primary/5'
												: 'hover:bg-accent/50'
										}`}
										onClick={() => setSelectedPermissionId(permission.id)}
									>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<h4 className="font-medium">{permission.name}</h4>
												{permission.category && (
													<Badge variant="secondary" className="text-xs">
														{permission.category.name}
													</Badge>
												)}
											</div>
											<p className="font-mono text-xs text-muted-foreground">{permission.urn}</p>
											{permission.description && (
												<p className="text-sm text-muted-foreground">{permission.description}</p>
											)}
										</div>
									</Card>
								))}
							</div>
						)}
					</div>

					{/* Target Type Selection */}
					{selectedPermission && (
						<div className="space-y-2">
							<Label htmlFor="target-type">
								Target Type <span className="text-destructive">*</span>
							</Label>
							<Select value={targetType} onValueChange={(value) => setTargetType(value as PermissionTarget)}>
								<SelectTrigger id="target-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all_members">
										<div className="flex items-center gap-2">
											<span>All Members</span>
										</div>
									</SelectItem>
									<SelectItem value="all_admins">
										<div className="flex items-center gap-2">
											<span>All Admins</span>
										</div>
									</SelectItem>
									<SelectItem value="owner_only">
										<div className="flex items-center gap-2">
											<span>Owner Only</span>
										</div>
									</SelectItem>
									<SelectItem value="owner_and_admins">
										<div className="flex items-center gap-2">
											<span>Owner & Admins</span>
										</div>
									</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Who in the group should receive this permission?
							</p>
							<div className="pt-2">
								<PermissionTargetBadge target={targetType} />
							</div>
						</div>
					)}

					{/* Action Buttons */}
					<div className="flex justify-end gap-2 pt-4">
						<CancelButton type="button" onClick={handleCancel} disabled={isSubmitting}>
							Cancel
						</CancelButton>
						<ConfirmButton
							type="submit"
							loading={isSubmitting}
							loadingText="Attaching..."
							disabled={!selectedPermissionId}
							showIcon={false}
						>
							<Plus className="mr-2 h-4 w-4" />
							Attach Permission
						</ConfirmButton>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	)
}
