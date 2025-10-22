import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAddDirector } from '@/hooks/useCorporations'

interface AddDirectorDialogProps {
	corporationId: number
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function AddDirectorDialog({ corporationId, open, onOpenChange }: AddDirectorDialogProps) {
	const [formData, setFormData] = useState({
		characterId: 0,
		characterName: '',
		priority: 100,
	})

	const addDirector = useAddDirector()

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!formData.characterId || !formData.characterName) {
			return
		}

		await addDirector.mutateAsync({
			corporationId,
			data: {
				characterId: formData.characterId,
				characterName: formData.characterName,
				priority: formData.priority,
			},
		})

		// Reset form and close dialog
		setFormData({ characterId: 0, characterName: '', priority: 100 })
		onOpenChange(false)
	}

	const handleClose = () => {
		// Reset form when closing
		setFormData({ characterId: 0, characterName: '', priority: 100 })
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Director</DialogTitle>
					<DialogDescription>
						Add a new director character to manage corporation data. The director needs appropriate
						corp roles to access ESI data.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="characterId">Character ID *</Label>
							<Input
								id="characterId"
								type="number"
								value={formData.characterId || ''}
								onChange={(e) =>
									setFormData({ ...formData, characterId: Number.parseInt(e.target.value) || 0 })
								}
								required
								placeholder="e.g., 2119123456"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="characterName">Character Name *</Label>
							<Input
								id="characterName"
								value={formData.characterName}
								onChange={(e) => setFormData({ ...formData, characterName: e.target.value })}
								required
								placeholder="e.g., Director Name"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="priority">Priority</Label>
							<Input
								id="priority"
								type="number"
								value={formData.priority}
								onChange={(e) =>
									setFormData({ ...formData, priority: Number.parseInt(e.target.value) || 100 })
								}
								placeholder="Lower number = higher priority"
							/>
							<p className="text-xs text-muted-foreground">
								Lower values have higher priority. Default is 100. Used for tie-breaking during
								round-robin selection.
							</p>
						</div>
					</div>
					<DialogFooter className="mt-6">
						<Button type="button" variant="ghost" onClick={handleClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={addDirector.isPending}>
							{addDirector.isPending ? 'Adding...' : 'Add Director'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
