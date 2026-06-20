import { useEffect, useState } from 'react'

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

import type { GroupWithDetails } from '@/lib/api'
import { Button } from '@/components/ui/button'

function sanitizeMumbleTickerInput(value: string): string {
	return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5)
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
		mumbleSyncEnabled === group.mumbleSyncEnabled && mumbleTicker.trim() === (group.mumbleTicker ?? '')

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Mumble Settings</DialogTitle>
					<DialogDescription>
						Configure whether "{group.name}" syncs to Mumble and which addendum appears after the
						group ticker. Only site admins can edit these settings.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
						<div className="space-y-1">
							<Label htmlFor="mumbleSyncEnabled" className="text-sm font-medium">
								Enable as Mumble Group
							</Label>
							<p className="text-xs text-muted-foreground">
								When enabled, this group will be assigned to members in Mumble.
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
							Mumble ticker addendum
						</Label>
						<Input
							id="mumbleTicker"
							value={mumbleTicker}
							onChange={(e) => setMumbleTicker(sanitizeMumbleTickerInput(e.target.value))}
							placeholder="optional"
							maxLength={5}
							pattern="[A-Za-z0-9]*"
							inputMode="text"
							disabled={updateGroup.isPending}
						/>
						<p className="text-xs text-muted-foreground">
							Optional. 1-5 alphanumeric characters appended to the user's Mumble display name.
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="cancel" onClick={handleCancel} disabled={updateGroup.isPending}>
						Cancel
					</Button>
					<Button
						variant="confirm"
						onClick={handleSave}
						loading={updateGroup.isPending}
						loadingText="Saving..."
						disabled={isUnchanged}
					>
						Save Changes
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
