/**
 * Doctrine Form Component
 *
 * Form for creating or editing a doctrine
 */

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api'

import { useDoctrineCategories } from '../hooks'

import type { SelectOption } from '@/components/ui/select'
import type { CreateDoctrineRequest, Doctrine, UpdateDoctrineRequest } from '../types'

interface ShipOption extends SelectOption {
	value: string
	label: string
}

interface DoctrineFormProps {
	doctrine?: Doctrine
	onSubmit: (data: CreateDoctrineRequest | UpdateDoctrineRequest) => void | Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function DoctrineForm({ doctrine, onSubmit, onCancel, isSubmitting }: DoctrineFormProps) {
	const [name, setName] = useState(doctrine?.name || '')
	const [description, setDescription] = useState(doctrine?.description || '')
	const [sortOrder, setSortOrder] = useState(doctrine?.sortOrder ?? 0)
	const [shipTypeId, setShipTypeId] = useState(doctrine?.shipTypeId || '')
	const [categoryId, setCategoryId] = useState(doctrine?.categoryId || '')
	const { data: categories } = useDoctrineCategories()

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		const data: CreateDoctrineRequest = {
			name,
			description: description || undefined,
			shipTypeId: shipTypeId || undefined,
			categoryId: categoryId || undefined,
			sortOrder,
		}

		onSubmit(data)
	}

	const searchShipTypes = async (query: string): Promise<ShipOption[]> => {
		const results = await api.searchShipTypes(query)
		return results.map((r) => ({ value: r.typeId, label: r.typeName }))
	}

	const canSubmit = name.trim() !== ''

	return (
		<form onSubmit={handleSubmit} className="space-y-6">
			{/* Name */}
			<div className="space-y-2">
				<Label htmlFor="name">Doctrine Name *</Label>
				<Input
					id="name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="e.g., Alpha Fleet, BLOPS Doctrine, Caracal Navy Issue"
					required
				/>
				<p className="text-sm text-muted-foreground">A descriptive name for this doctrine</p>
			</div>

			{/* Description */}
			<div className="space-y-2">
				<Label htmlFor="description">Description</Label>
				<Textarea
					id="description"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					placeholder="Describe the purpose, composition, or usage of this doctrine..."
					className="min-h-[100px]"
				/>
				<p className="text-sm text-muted-foreground">
					A short description shown on the doctrine card
				</p>
			</div>

			{/* Category */}
			<div className="space-y-2">
				<Label>Category</Label>
				<Select
					options={[
						{ value: '', label: 'No category' },
						...(categories || []).map((c) => ({ value: c.id, label: c.name })),
					]}
					value={categoryId}
					onValueChange={(val) => setCategoryId(val)}
					placeholder="Select a category..."
				/>
				<p className="text-sm text-muted-foreground">
					Group this doctrine under a category
				</p>
			</div>

			{/* Ship Icon */}
			<div className="space-y-2">
				<Label>Ship Icon</Label>
				<div className="flex items-center gap-3">
					{shipTypeId && (
						<img
							src={`https://images.evetech.net/types/${shipTypeId}/icon?size=64`}
							alt="Ship icon"
							className="h-10 w-10 rounded"
						/>
					)}
					<div className="flex-1">
						<Select<ShipOption>
							options={[]}
							value={shipTypeId}
							onValueChange={(val) => setShipTypeId(val)}
							searchable
							searchDelegate={searchShipTypes}
							minQueryLength={2}
							debounceMs={300}
							placeholder="Search for a ship..."
							emptyText="No ships found"
							queryHintText="Type at least 2 characters to search"
							renderOption={(option) => (
								<div className="flex items-center gap-2">
									<img
										src={`https://images.evetech.net/types/${option.value}/icon?size=32`}
										alt=""
										className="h-5 w-5 rounded"
									/>
									<span>{option.label}</span>
								</div>
							)}
						/>
					</div>
				</div>
				<p className="text-sm text-muted-foreground">
					Search for a ship to use as the doctrine icon
				</p>
			</div>

			{/* Sort Order */}
			<div className="space-y-2">
				<Label htmlFor="sortOrder">Sort Order</Label>
				<Input
					id="sortOrder"
					type="number"
					value={sortOrder}
					onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
					min="0"
					className="w-32"
				/>
				<p className="text-sm text-muted-foreground">
					Lower numbers appear first on the doctrines page
				</p>
			</div>

			{/* Actions */}
			<div className="flex justify-end gap-2">
				<Button variant="cancel" onClick={onCancel} type="button">
					Cancel
				</Button>
				<Button
					variant="confirm"
					type="submit"
					loading={isSubmitting}
					loadingText={doctrine ? 'Updating...' : 'Creating...'}
					disabled={!canSubmit || isSubmitting}
				>
					{doctrine ? 'Update Doctrine' : 'Create Doctrine'}
				</Button>
			</div>
		</form>
	)
}

