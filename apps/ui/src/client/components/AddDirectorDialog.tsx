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
import { useAppTranslation } from '@/i18n'

import type { FormEvent } from 'react'

interface AddDirectorDialogProps {
	corporationId: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function AddDirectorDialog({ corporationId, open, onOpenChange }: AddDirectorDialogProps) {
	const { t } = useAppTranslation()
	const [formData, setFormData] = useState<{
		characterId: string
		characterName: string
		priority: number
	}>({
		characterId: '',
		characterName: '',
		priority: 100,
	})

	const addDirector = useAddDirector()

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault()

		const characterId = formData.characterId
		if (!characterId || !formData.characterName) {
			return
		}

		await addDirector.mutateAsync({
			corporationId,
			data: {
				characterId,
				characterName: formData.characterName,
				priority: formData.priority,
			},
		})

		// Reset form and close dialog
		setFormData({ characterId: '', characterName: '', priority: 100 })
		onOpenChange(false)
	}

	const handleClose = () => {
		// Reset form when closing
		setFormData({ characterId: '', characterName: '', priority: 100 })
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('admin.organizations.directors.add')}</DialogTitle>
					<DialogDescription>{t('admin.organizations.directors.addDescription')}</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="characterId">{t('admin.organizations.directors.characterId')}</Label>
							<Input
								id="characterId"
								type="text"
								inputMode="numeric"
								pattern="[0-9]*"
								value={formData.characterId}
								onChange={(e) => setFormData({ ...formData, characterId: e.target.value })}
								required
								placeholder={t('admin.organizations.directors.characterIdExample')}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="characterName">
								{t('admin.organizations.directors.characterName')}
							</Label>
							<Input
								id="characterName"
								value={formData.characterName}
								onChange={(e) => setFormData({ ...formData, characterName: e.target.value })}
								required
								placeholder={t('admin.organizations.directors.nameExample')}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="priority">{t('admin.organizations.shared.priority')}</Label>
							<Input
								id="priority"
								type="number"
								value={formData.priority}
								onChange={(e) => {
									const value = Number.parseInt(e.target.value)
									setFormData({ ...formData, priority: Number.isNaN(value) ? 100 : value })
								}}
								placeholder={t('admin.organizations.directors.priorityPlaceholder')}
							/>
							<p className="text-xs text-muted-foreground">
								{t('admin.organizations.directors.priorityHint')}
							</p>
						</div>
					</div>
					<DialogFooter className="mt-6">
						<Button variant="cancel" type="button" onClick={handleClose}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="confirm"
							type="submit"
							loading={addDirector.isPending}
							loadingText={t('admin.organizations.corp.adding')}
						>
							{t('admin.organizations.directors.add')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
