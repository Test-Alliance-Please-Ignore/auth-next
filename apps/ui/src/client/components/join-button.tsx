import { Clock, Send, UserPlus } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useCreateJoinRequest, useJoinGroup } from '@/hooks/useGroups'
import { useAppTranslation } from '@/i18n'

import type { GroupWithDetails } from '@/lib/api'

interface JoinButtonProps {
	group: GroupWithDetails
	onSuccess?: () => void
	compact?: boolean
}

export function JoinButton({ group, onSuccess, compact = false }: JoinButtonProps) {
	const { t } = useAppTranslation()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [reason, setReason] = useState('')
	const joinGroup = useJoinGroup()
	const createJoinRequest = useCreateJoinRequest()

	const handleJoinOpen = async () => {
		if (group.joinMode === 'open') {
			// Join directly
			try {
				await joinGroup.mutateAsync(group.id)
				onSuccess?.()
			} catch (error) {
				console.error('Failed to join group:', error)
			}
		} else if (group.joinMode === 'approval') {
			// Open dialog for join request
			setDialogOpen(true)
		} else if (group.joinMode === 'invitation_only') {
			// Cannot join - this should not happen as button is disabled
			return
		}
	}

	const handleSubmitRequest = async () => {
		try {
			await createJoinRequest.mutateAsync({
				groupId: group.id,
				reason,
			})
			setDialogOpen(false)
			setReason('')
			onSuccess?.()
		} catch (error) {
			console.error('Failed to create join request:', error)
		}
	}

	const isLoading = joinGroup.isPending || createJoinRequest.isPending

	if (group.isMember) {
		return null
	}

	if (group.joinMode === 'admin_managed') {
		return (
			<Button disabled variant="ghost">
				<UserPlus className="h-4 w-4" />
				{t('groups.join.managed')}
			</Button>
		)
	}

	if (group.hasPendingJoinRequest) {
		return (
			<Button disabled variant="ghost">
				<Clock className="h-4 w-4" />
				{t('groups.join.pending')}
			</Button>
		)
	}

	if (group.joinMode === 'invitation_only') {
		return (
			<Button disabled variant="ghost">
				{t('groups.join.invitationOnly')}
			</Button>
		)
	}

	return (
		<>
			<Button
				variant={compact ? (group.joinMode === 'open' ? 'success' : 'primary') : undefined}
				size={compact ? 'sm' : undefined}
				showIcon={compact ? false : undefined}
				onClick={handleJoinOpen}
				disabled={isLoading}
			>
				<UserPlus className="h-4 w-4" />
				{compact
					? group.joinMode === 'open'
						? t('groups.join.join')
						: t('groups.join.apply')
					: group.joinMode === 'open'
						? t('groups.join.joinGroup')
						: t('groups.join.requestJoin')}
			</Button>

			{/* Join Request Dialog */}
			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('groups.join.dialogTitle', { name: group.name })}</DialogTitle>
						<DialogDescription>{t('groups.join.description')}</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="reason">{t('groups.join.reason')}</Label>
							<Textarea
								id="reason"
								value={reason}
								onChange={(e) => setReason((e.target as HTMLTextAreaElement).value)}
								placeholder={t('groups.join.reasonPlaceholder')}
								rows={3}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="cancel" onClick={() => setDialogOpen(false)} disabled={isLoading}>
							{t('common.cancel')}
						</Button>
						<Button
							variant="confirm"
							onClick={handleSubmitRequest}
							disabled={isLoading}
							loading={isLoading}
							loadingText={t('groups.join.sending')}
							showIcon={false}
						>
							<Send className="h-4 w-4" />
							{t('groups.join.send')}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
