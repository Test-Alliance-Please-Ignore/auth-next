import { Edit2, Trash2 } from 'lucide-react'
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

import type { Category } from '@/lib/api'

interface CategoryListProps {
	categories: Category[]
	onEdit: (category: Category) => void
	onDelete: (category: Category) => void
	isLoading?: boolean
}

export function CategoryList({ categories, onEdit, onDelete, isLoading }: CategoryListProps) {
	if (isLoading) {
		return (
			<div className="space-y-4">
				{[...Array(3)].map((_, i) => (
					<div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
				))}
			</div>
		)
	}

	if (categories.length === 0) {
		return (
			<div className="rounded-md border border-dashed p-8 text-center">
				<p className="text-muted-foreground">
					No categories yet. Create your first category to get started.
				</p>
			</div>
		)
	}

	return (
		<div className="rounded-md border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Description</TableHead>
						<TableHead>Visibility</TableHead>
						<TableHead>Group Creation</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{categories.map((category) => (
						<TableRow key={category.id}>
							<TableCell className="font-medium">{category.name}</TableCell>
							<TableCell className="max-w-md">
								<div className="truncate text-muted-foreground">
									{category.description || <span className="italic">No description</span>}
								</div>
							</TableCell>
							<TableCell>
								<VisibilityBadge visibility={category.visibility} />
							</TableCell>
							<TableCell>
								<span className="text-sm">
									{category.allowGroupCreation === 'anyone' ? 'Anyone' : 'Admin Only'}
								</span>
							</TableCell>
							<TableCell className="text-right">
								<div className="flex justify-end gap-2">
									<Button
										variant="ghost"
										size="icon"
										onClick={() => onEdit(category)}
										title="Edit category"
									>
										<Edit2 className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => onDelete(category)}
										title="Delete category"
										className="text-destructive hover:text-destructive"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	)
}
