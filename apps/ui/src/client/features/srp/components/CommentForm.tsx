import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAppTranslation } from '@/i18n'
import toast from '@/lib/toast'

import { useAddComment, useUpdateComment } from '../hooks'
import { SRPFeedback } from './SRPFeedback'

import type { AppTranslationKey } from '@/i18n'
import type { SRPCommentResponse } from '../types'

const commentSchema = z.object({
	content: z
		.string()
		.min(1, 'srp.validation.commentRequired')
		.max(5000, 'srp.validation.commentTooLong'),
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
	const { t } = useAppTranslation()
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
				toast.success(<SRPFeedback messageKey="srp.comments.updated" />)
			} else {
				await addMutation.mutateAsync({
					requestId,
					data: {
						content: data.content,
						visibility: data.visibility,
					},
				})
				toast.success(<SRPFeedback messageKey="srp.comments.added" />)
				form.reset()
			}
			onSuccess()
		} catch (error: any) {
			toast.error(
				editingComment ? (
					<SRPFeedback messageKey="srp.comments.updateFailed" />
				) : (
					<SRPFeedback messageKey="srp.comments.addFailed" />
				),
				{
					description: error.message,
				}
			)
		}
	})

	const isPending = addMutation.isPending || updateMutation.isPending

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div>
				<Textarea
					{...form.register('content')}
					placeholder={t('srp.comments.placeholder')}
					rows={4}
					disabled={isPending}
				/>
				{form.formState.errors.content && (
					<p className="mt-1 text-xs text-red-500">
						{t(form.formState.errors.content.message as AppTranslationKey)}
					</p>
				)}
				<p className="mt-1 text-xs text-muted-foreground">
					{t('srp.comments.characterCount', { count: form.watch('content').length, max: 5000 })}
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
						{t('srp.comments.internalHint')}
					</Label>
				</div>
			)}

			<div className="flex gap-2">
				{onCancel && (
					<Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
						{t('srp.common.cancel')}
					</Button>
				)}
				<Button type="submit" disabled={isPending}>
					{isPending
						? editingComment
							? t('srp.comments.updating')
							: t('srp.comments.adding')
						: editingComment
							? t('srp.comments.update')
							: t('srp.comments.add')}
				</Button>
			</div>
		</form>
	)
}
