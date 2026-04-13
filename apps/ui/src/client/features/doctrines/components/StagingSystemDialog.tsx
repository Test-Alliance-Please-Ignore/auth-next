import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { esiApi } from '@/lib/esi-api'
import toast from '@/lib/toast'

import { useCreateStagingSystem, useUpdateStagingSystem } from '../hooks'

import type { StagingSystem } from '../types'

interface StagingSystemDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	stagingSystem?: StagingSystem
}

export function StagingSystemDialog({
	open,
	onOpenChange,
	stagingSystem,
}: StagingSystemDialogProps) {
	const [solarSystemName, setSolarSystemName] = useState(stagingSystem?.solarSystemName || '')
	const [solarSystemId, setSolarSystemId] = useState(stagingSystem?.solarSystemId || '')
	const [sortOrder, setSortOrder] = useState(stagingSystem?.sortOrder ?? 0)
	const createMutation = useCreateStagingSystem()
	const updateMutation = useUpdateStagingSystem()

	const isEdit = !!stagingSystem

	const searchSystems = async (query: string) => {
		const results = await esiApi.searchSystems(query)
		return results.map((r) => ({
			value: r.systemId,
			label: r.systemName,
			description: r.regionName,
		}))
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		try {
			if (isEdit) {
				await updateMutation.mutateAsync({
					id: stagingSystem.id,
					data: { solarSystemName, solarSystemId, sortOrder },
				})
				toast.success('Staging system updated')
			} else {
				await createMutation.mutateAsync({ solarSystemName, solarSystemId, sortOrder })
				toast.success('Staging system created')
			}
			onOpenChange(false)
			setSolarSystemName('')
			setSolarSystemId('')
			setSortOrder(0)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save staging system')
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>{isEdit ? 'Edit Staging System' : 'New Staging System'}</DialogTitle>
					</DialogHeader>
					<div className="space-y-4 py-4">
						{isEdit ? (
							<div className="space-y-2">
								<Label>System</Label>
								<p className="text-sm text-foreground">{solarSystemName}</p>
							</div>
						) : (
							<div className="space-y-2">
								<Label>Solar System</Label>
								<Select
									options={[]}
									value={solarSystemId}
									onValueChange={(val, option) => {
										setSolarSystemId(val)
										setSolarSystemName(option?.label || '')
									}}
									searchable
									searchDelegate={searchSystems}
									minQueryLength={3}
									debounceMs={500}
									placeholder="Search for a system..."
									emptyText="No systems found"
									queryHintText="Type at least 3 characters to search"
								/>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="sys-sort">Sort Order</Label>
							<Input
								id="sys-sort"
								type="number"
								value={sortOrder}
								onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
								min="0"
								className="w-32"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" type="button" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={createMutation.isPending || updateMutation.isPending}
							loadingText="Saving..."
							disabled={!solarSystemName.trim() || !solarSystemId.trim()}
						>
							{isEdit ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
