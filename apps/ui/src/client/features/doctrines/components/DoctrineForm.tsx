/**
 * Doctrine Form Component
 *
 * Form for creating or editing a doctrine
 */

import { useState } from 'react'

import { CancelButton } from '@/components/ui/cancel-button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import type { CreateDoctrineRequest, Doctrine, UpdateDoctrineRequest } from '../types'

interface DoctrineFormProps {
	doctrine?: Doctrine
	onSubmit: (data: CreateDoctrineRequest | UpdateDoctrineRequest) => void | Promise<void>
	onCancel: () => void
	isSubmitting?: boolean
}

export function DoctrineForm({ doctrine, onSubmit, onCancel, isSubmitting }: DoctrineFormProps) {
	const [name, setName] = useState(doctrine?.name || '')
	const [category, setCategory] = useState(doctrine?.category || '')
	const [maintainer, setMaintainer] = useState(doctrine?.maintainer || '')

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()

		const data = {
			name,
			category,
			maintainer,
		}

		onSubmit(data)
	}

	const canSubmit = name.trim() !== '' && category.trim() !== '' && maintainer.trim() !== ''

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

			{/* Category */}
			<div className="space-y-2">
				<Label htmlFor="category">Category *</Label>
				<Input
					id="category"
					value={category}
					onChange={(e) => setCategory(e.target.value)}
					placeholder="e.g., Shield Fleets, Armor Fleets, Black Ops"
					required
				/>
				<p className="text-sm text-muted-foreground">
					Group this doctrine under a category for organization
				</p>
			</div>

			{/* Maintainer */}
			<div className="space-y-2">
				<Label htmlFor="maintainer">Maintainer *</Label>
				<Input
					id="maintainer"
					value={maintainer}
					onChange={(e) => setMaintainer(e.target.value)}
					placeholder="Character name or group responsible"
					required
				/>
				<p className="text-sm text-muted-foreground">
					Who is responsible for maintaining this doctrine?
				</p>
			</div>

			{/* Actions */}
			<div className="flex justify-end gap-2">
				<CancelButton onClick={onCancel} type="button">
					Cancel
				</CancelButton>
				<ConfirmButton
					type="submit"
					loading={isSubmitting}
					loadingText={doctrine ? 'Updating...' : 'Creating...'}
					disabled={!canSubmit || isSubmitting}
				>
					{doctrine ? 'Update Doctrine' : 'Create Doctrine'}
				</ConfirmButton>
			</div>
		</form>
	)
}
