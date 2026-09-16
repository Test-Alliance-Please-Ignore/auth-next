import { Edit, Lock, Trash } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { useAppTranslation } from '@/i18n'
import { characterPortraitUrl } from '@/lib/eve-images'
import toast from '@/lib/toast'

import { useDeleteComment } from '../hooks'
import { formatRelativeTime } from '../utils'
import { CharacterRoleBadge } from './CharacterRoleBadge'
import { CommentForm } from './CommentForm'
import { SRPFeedback } from './SRPFeedback'

import type { SRPCommentResponse } from '../types'

interface CommentsListProps {
	comments: SRPCommentResponse[]
	requestId: string
	canAddInternal: boolean
	onCommentAdded: () => void
	initialContext?: {
		content: string
		authorCharacterName: string
		authorCharacterId?: string
		authorCharacterRole?: 'main' | 'alt'
		authorMainCharacterName?: string
		authorMainCharacterId?: string
		createdAt: string
	}
}

export function CommentsList({
	comments,
	requestId,
	canAddInternal,
	onCommentAdded,
	initialContext,
}: CommentsListProps) {
	const { t } = useAppTranslation()
	const { user } = useAuth()
	const [editingId, setEditingId] = useState<string | null>(null)
	const deleteMutation = useDeleteComment()

	const handleDelete = async (id: string) => {
		if (!confirm(t('srp.comments.deleteConfirm'))) return

		try {
			await deleteMutation.mutateAsync(id)
			toast.success(<SRPFeedback messageKey="srp.comments.deleted" />)
			onCommentAdded() // Refresh list
		} catch (error: any) {
			toast.error(<SRPFeedback messageKey="srp.comments.deleteFailed" />, {
				description: error.message,
			})
		}
	}

	const canEdit = (comment: SRPCommentResponse) => user?.id === comment.authorUserId
	const canDelete = (comment: SRPCommentResponse) =>
		user?.id === comment.authorUserId || user?.is_admin

	if (!initialContext && comments.length === 0) {
		return (
			<Card className="p-6 text-center">
				<p className="text-sm text-muted-foreground">{t('srp.comments.empty')}</p>
			</Card>
		)
	}

	return (
		<div className="space-y-4">
			{initialContext && (
				<Card className="p-4">
					<div className="mb-2 flex items-start justify-between">
						<div className="flex items-start gap-3">
							{initialContext.authorCharacterId ? (
								<img
									src={characterPortraitUrl(initialContext.authorCharacterId, 32)}
									alt={initialContext.authorCharacterName}
									className="h-8 w-8 rounded-full shrink-0 mt-0.5"
								/>
							) : (
								<div className="h-8 w-8 rounded-full bg-muted shrink-0 mt-0.5" />
							)}
							<div>
								<div className="flex items-center gap-2 flex-wrap">
									<span className="font-medium">{initialContext.authorCharacterName}</span>
									<CharacterRoleBadge
										role={initialContext.authorCharacterRole}
										mainCharacterName={initialContext.authorMainCharacterName}
										mainCharacterId={initialContext.authorMainCharacterId}
									/>
									<span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
										{t('srp.comments.requestor')}
									</span>
									<span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
										{t('srp.comments.initialContext')}
									</span>
								</div>
								<div className="text-xs text-muted-foreground">
									{formatRelativeTime(initialContext.createdAt)}
								</div>
							</div>
						</div>
					</div>
					<div className="whitespace-pre-wrap text-sm">{initialContext.content}</div>
				</Card>
			)}
			{comments.map((comment) => (
				<Card key={comment.id} className="p-4">
					{editingId === comment.id ? (
						<CommentForm
							requestId={requestId}
							editingComment={comment}
							canAddInternal={canAddInternal}
							onSuccess={() => {
								setEditingId(null)
								onCommentAdded()
							}}
							onCancel={() => setEditingId(null)}
						/>
					) : (
						<>
							<div className="mb-2 flex items-start justify-between">
								<div className="flex items-start gap-3">
									{comment.authorCharacterId ? (
										<img
											src={characterPortraitUrl(comment.authorCharacterId, 32)}
											alt={comment.authorCharacterName || t('srp.common.you')}
											className="h-8 w-8 rounded-full shrink-0 mt-0.5"
										/>
									) : (
										<div className="h-8 w-8 rounded-full bg-muted shrink-0 mt-0.5" />
									)}
									<div>
										<div className="flex items-center gap-2 flex-wrap">
											<span className="font-medium">
												{comment.authorCharacterName || t('srp.common.you')}
											</span>
											<CharacterRoleBadge
												role={comment.authorCharacterRole}
												mainCharacterName={comment.authorMainCharacterName}
												mainCharacterId={comment.authorMainCharacterId}
											/>
											{comment.authorRole === 'requestor' && (
												<span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
													{t('srp.comments.requestor')}
												</span>
											)}
											{comment.authorRole === 'staff' && (
												<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
													{t('srp.comments.staff')}
												</span>
											)}
											{comment.visibility === 'internal' && (
												<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
													<Lock className="h-3 w-3" />
													{t('srp.comments.internal')}
												</span>
											)}
											{comment.isEdited && (
												<span className="text-xs text-muted-foreground">
													{t('srp.comments.edited')}
												</span>
											)}
										</div>
										<div className="text-xs text-muted-foreground">
											{formatRelativeTime(comment.createdAt)}
										</div>
									</div>
								</div>
								{(canEdit(comment) || canDelete(comment)) && (
									<div className="flex gap-1">
										{canEdit(comment) && (
											<Button
												variant="ghost"
												size="sm"
												aria-label={t('srp.comments.edit')}
												onClick={() => setEditingId(comment.id)}
											>
												<Edit className="h-4 w-4" />
											</Button>
										)}
										{canDelete(comment) && (
											<Button
												variant="ghost"
												size="sm"
												aria-label={t('srp.comments.delete')}
												onClick={() => handleDelete(comment.id)}
											>
												<Trash className="h-4 w-4" />
											</Button>
										)}
									</div>
								)}
							</div>
							<div className="whitespace-pre-wrap text-sm">{comment.content}</div>
						</>
					)}
				</Card>
			))}
		</div>
	)
}
