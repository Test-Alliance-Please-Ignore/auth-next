import { CheckCircle2, Search } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { usePermissionCategories } from '@/hooks/usePermissionCategories'
import { useGlobalPermissions } from '@/hooks/usePermissions'

interface GlobalPermissionPickerProps {
	selectedPermissionId: string
	onSelectPermissionId: (permissionId: string) => void
}

export function GlobalPermissionPicker({
	selectedPermissionId,
	onSelectPermissionId,
}: GlobalPermissionPickerProps) {
	const { data: permissions = [], isLoading } = useGlobalPermissions()
	const { data: categories = [] } = usePermissionCategories()
	const [searchQuery, setSearchQuery] = useState('')
	const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)

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

	return (
		<div className="space-y-4">
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
					<Select
						value={categoryFilter || 'all'}
						onValueChange={(value) => setCategoryFilter(value === 'all' ? undefined : value)}
						inputId="category-filter-attach"
						options={[
							{ value: 'all', label: 'All categories' },
							{ value: 'uncategorized', label: 'Uncategorized' },
							...categories.map((category) => ({ value: category.id, label: category.name })),
						]}
						placeholder="All categories"
					/>
				</div>
			</div>

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
						{filteredPermissions.map((permission) => {
							const isSelected = selectedPermissionId === permission.id
							return (
								<Card
									key={permission.id}
									className={`p-3 cursor-pointer transition-all ${
										isSelected
											? 'border-primary bg-primary/10 ring-2 ring-primary/40 shadow-sm'
											: 'hover:bg-accent/50 hover:border-primary/40'
									}`}
									onClick={() => onSelectPermissionId(permission.id)}
									role="button"
									aria-pressed={isSelected}
								>
									<div className="space-y-1">
										<div className="flex items-start justify-between gap-2">
											<div className="flex items-center gap-2">
												<h4 className="font-medium">{permission.name}</h4>
												{permission.category && (
													<Badge variant="secondary" className="text-xs">
														{permission.category.name}
													</Badge>
												)}
											</div>
											{isSelected && (
												<div className="inline-flex items-center gap-1 text-xs font-medium text-primary">
													<CheckCircle2 className="h-4 w-4" />
													Selected
												</div>
											)}
										</div>
										<p className="font-mono text-xs text-muted-foreground">{permission.urn}</p>
										{permission.description && (
											<p className="text-sm text-muted-foreground">{permission.description}</p>
										)}
									</div>
								</Card>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
