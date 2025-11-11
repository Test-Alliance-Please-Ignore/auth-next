import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { Edit, Lock, Trash } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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

export function CommentsList({ comments, requestId, canAddInternal, onCommentAdded }: CommentsListProps) {
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
				<p className="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
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
								<div>
									<div className="flex items-center gap-2">
										<span className="font-medium">{comment.authorCharacterName}</span>
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
								{(canEdit(comment) || canDelete(comment)) && (
									<div className="flex gap-1">
										{canEdit(comment) && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setEditingId(comment.id)}
											>
												<Edit className="h-4 w-4" />
											</Button>
										)}
										{canDelete(comment) && (
											<Button
												variant="ghost"
												size="sm"
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
