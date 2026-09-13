import { useEffect, useState } from 'react'

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
import { Switch } from '@/components/ui/switch'
import { useUpdateGroup } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

import type { GroupWithDetails } from '@/lib/api'

function sanitizeMumbleTickerInput(value: string): string {
	return value
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
		.slice(0, 5)
}

interface EditGroupMumbleDialogProps {
	group: GroupWithDetails
	open: boolean
	onOpenChange: (open: boolean) => void
	onSuccess?: () => void
}

export function EditGroupMumbleDialog({
	group,
	open,
	onOpenChange,
	onSuccess,
}: EditGroupMumbleDialogProps) {
	const { t } = useAppTranslation()
	const [mumbleSyncEnabled, setMumbleSyncEnabled] = useState<boolean>(group.mumbleSyncEnabled)
	const [mumbleTicker, setMumbleTicker] = useState<string>(group.mumbleTicker ?? '')
	const updateGroup = useUpdateGroup()

	useEffect(() => {
		setMumbleSyncEnabled(group.mumbleSyncEnabled)
		setMumbleTicker(group.mumbleTicker ?? '')
	}, [group])

	const handleSave = async () => {
		const normalizedTicker = mumbleTicker.trim()
		const tickerChanged = normalizedTicker !== (group.mumbleTicker ?? '')
		const syncChanged = mumbleSyncEnabled !== group.mumbleSyncEnabled

		if (!tickerChanged && !syncChanged) {
			return
		}

		try {
			await updateGroup.mutateAsync({
				id: group.id,
				data: {
					mumbleSyncEnabled,
					mumbleTicker: normalizedTicker,
				},
			})
			onOpenChange(false)
			onSuccess?.()
		} catch (error) {
			console.error('Failed to update group Mumble settings:', error)
		}
	}

	const handleCancel = () => {
		setMumbleSyncEnabled(group.mumbleSyncEnabled)
		setMumbleTicker(group.mumbleTicker ?? '')
		onOpenChange(false)
	}

	const isUnchanged =
		mumbleSyncEnabled === group.mumbleSyncEnabled &&
		mumbleTicker.trim() === (group.mumbleTicker ?? '')

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('groups.mumble.title')}</DialogTitle>
					<DialogDescription>
						{t('groups.mumble.description', { name: group.name })}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
						<div className="space-y-1">
							<Label htmlFor="mumbleSyncEnabled" className="text-sm font-medium">
								{t('groups.mumble.enable')}
							</Label>
							<p className="text-xs text-muted-foreground">
								{t('groups.mumble.enableDescription')}
							</p>
						</div>
						<Switch
							id="mumbleSyncEnabled"
							checked={mumbleSyncEnabled}
							onCheckedChange={setMumbleSyncEnabled}
							disabled={updateGroup.isPending}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="mumbleTicker" className="text-sm font-medium">
							{t('groups.mumble.ticker')}
						</Label>
						<Input
							id="mumbleTicker"
							value={mumbleTicker}
							onChange={(e) => setMumbleTicker(sanitizeMumbleTickerInput(e.target.value))}
							placeholder={t('groups.mumble.optional')}
							maxLength={5}
							pattern="[A-Za-z0-9]*"
							inputMode="text"
							disabled={updateGroup.isPending}
						/>
						<p className="text-xs text-muted-foreground">{t('groups.mumble.tickerHint')}</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="cancel" onClick={handleCancel} disabled={updateGroup.isPending}>
						{t('common.cancel')}
					</Button>
					<Button
						variant="confirm"
						onClick={handleSave}
						loading={updateGroup.isPending}
						loadingText={t('groups.edit.saving')}
						disabled={isUnchanged}
					>
						{t('groups.edit.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
