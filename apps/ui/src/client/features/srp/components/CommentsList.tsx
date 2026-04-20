import { Edit, Lock, Trash } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { characterPortraitUrl } from '@/lib/eve-images'

import { useDeleteComment } from '../hooks'
import { formatRelativeTime } from '../utils'
import { CommentForm } from './CommentForm'

import type { SRPCommentResponse } from '../types'

interface CommentsListProps {
	comments: SRPCommentResponse[]
	requestId: string
	canAddInternal: boolean
	onCommentAdded: () => void
}

export function CommentsList({
	comments,
	requestId,
	canAddInternal,
	onCommentAdded,
}: CommentsListProps) {
	const { user } = useAuth()
	const [editingId, setEditingId] = useState<string | null>(null)
	const deleteMutation = useDeleteComment()

	const handleDelete = async (id: string) => {
		if (!confirm('Are you sure you want to delete this comment?')) return

		try {
			await deleteMutation.mutateAsync(id)
			toast.success('Comment deleted')
			onCommentAdded() // Refresh list
		} catch (error: any) {
			toast.error('Failed to delete comment', {
				description: error.message,
			})
		}
	}

	const canEdit = (comment: SRPCommentResponse) => user?.id === comment.authorUserId
	const canDelete = (comment: SRPCommentResponse) =>
		user?.id === comment.authorUserId || user?.is_admin

	if (comments.length === 0) {
		return (
			<Card className="p-6 text-center">
				<p className="text-sm text-muted-foreground">No comments.</p>
			</Card>
		)
	}

	return (
		<div className="space-y-4">
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
											alt={comment.authorCharacterName}
											className="h-8 w-8 rounded-full shrink-0 mt-0.5"
										/>
									) : (
										<div className="h-8 w-8 rounded-full bg-muted shrink-0 mt-0.5" />
									)}
									<div>
										<div className="flex items-center gap-2 flex-wrap">
											<span className="font-medium">{comment.authorCharacterName}</span>
											{comment.authorRole === 'requestor' && (
												<span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-400">
													Requestor
												</span>
											)}
											{comment.authorRole === 'staff' && (
												<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-400">
													SRP Staff
												</span>
											)}
											{comment.visibility === 'internal' && (
												<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
													<Lock className="h-3 w-3" />
													Internal
												</span>
											)}
											{comment.isEdited && (
												<span className="text-xs text-muted-foreground">(edited)</span>
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
											<Button variant="ghost" size="sm" onClick={() => setEditingId(comment.id)}>
												<Edit className="h-4 w-4" />
											</Button>
										)}
										{canDelete(comment) && (
											<Button variant="ghost" size="sm" onClick={() => handleDelete(comment.id)}>
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
