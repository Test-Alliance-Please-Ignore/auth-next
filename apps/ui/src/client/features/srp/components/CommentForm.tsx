import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useAddComment, useUpdateComment } from '../hooks'
import type { CommentVisibility, SRPCommentResponse } from '../types'

const commentSchema = z.object({
	content: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment too long'),
	visibility: z.enum(['public', 'internal']),
})

type CommentFormData = z.infer<typeof commentSchema>

interface CommentFormProps {
	requestId: string
	editingComment?: SRPCommentResponse
	canAddInternal: boolean
	onSuccess: () => void
	onCancel?: () => void
}

export function CommentForm({
	requestId,
	editingComment,
	canAddInternal,
	onSuccess,
	onCancel,
}: CommentFormProps) {
	const addMutation = useAddComment()
	const updateMutation = useUpdateComment()

	const form = useForm<CommentFormData>({
		resolver: zodResolver(commentSchema),
		defaultValues: {
			content: editingComment?.content || '',
			visibility: editingComment?.visibility || 'public',
		},
	})

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			if (editingComment) {
				await updateMutation.mutateAsync({
					id: editingComment.id,
					content: data.content,
				})
				toast.success('Comment updated')
			} else {
				await addMutation.mutateAsync({
					requestId,
					data: {
						content: data.content,
						visibility: data.visibility,
					},
				})
				toast.success('Comment added')
				form.reset()
			}
			onSuccess()
		} catch (error: any) {
			toast.error(editingComment ? 'Failed to update comment' : 'Failed to add comment', {
				description: error.message,
			})
		}
	})

	const isPending = addMutation.isPending || updateMutation.isPending

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div>
				<Textarea
					{...form.register('content')}
					placeholder="Add a comment..."
					rows={4}
					disabled={isPending}
				/>
				{form.formState.errors.content && (
					<p className="mt-1 text-xs text-red-500">{form.formState.errors.content.message}</p>
				)}
				<p className="mt-1 text-xs text-muted-foreground">
					{form.watch('content').length}/5000 characters
				</p>
			</div>

			{canAddInternal && !editingComment && (
				<div className="flex items-center gap-2">
					<Switch
						id="internal"
						checked={form.watch('visibility') === 'internal'}
						onCheckedChange={(checked) =>
							form.setValue('visibility', checked ? 'internal' : 'public')
						}
					/>
					<Label htmlFor="internal" className="text-sm">
						Internal comment (only visible to reviewers and admins)
					</Label>
				</div>
			)}

			<div className="flex gap-2">
				{onCancel && (
					<Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
						Cancel
					</Button>
				)}
				<Button type="submit" disabled={isPending}>
					{isPending
						? editingComment
							? 'Updating...'
							: 'Adding...'
						: editingComment
							? 'Update Comment'
							: 'Add Comment'}
				</Button>
			</div>
		</form>
	)
}
