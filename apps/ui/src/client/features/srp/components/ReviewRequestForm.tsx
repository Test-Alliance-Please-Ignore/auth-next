import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { useApproveRequest, usePartiallyApproveRequest, useRejectRequest } from '../hooks'
import { formatISK } from '../utils'

import type { SRPRequestResponse } from '../types'

const reviewSchema = z
	.object({
		action: z.enum(['approve', 'partially_approve', 'reject']),
		approvedAmount: z.string().optional(),
		rejectionReason: z.string().optional(),
		reviewNotes: z.string().max(2000, 'Notes too long').optional(),
	})
	.refine(
		(data) => {
			if (data.action === 'partially_approve' && !data.approvedAmount) {
				return false
			}
			if (data.action === 'reject' && !data.rejectionReason) {
				return false
			}
			return true
		},
		{
			message: 'Required field missing',
		}
	)

type ReviewFormData = z.infer<typeof reviewSchema>

interface ReviewRequestFormProps {
	request: SRPRequestResponse
	onSuccess: () => void
}

export function ReviewRequestForm({ request, onSuccess }: ReviewRequestFormProps) {
	const [showConfirm, setShowConfirm] = useState(false)
	const approveMutation = useApproveRequest()
	const partialApproveMutation = usePartiallyApproveRequest()
	const rejectMutation = useRejectRequest()

	const form = useForm<ReviewFormData>({
		resolver: zodResolver(reviewSchema),
		defaultValues: {
			action: 'approve',
			approvedAmount: request.requestedAmount || request.shipValue,
			rejectionReason: '',
			reviewNotes: '',
		},
	})

	const action = form.watch('action')

	const onSubmit = form.handleSubmit(async (data) => {
		if (data.action === 'reject' && !showConfirm) {
			setShowConfirm(true)
			return
		}

		try {
			if (data.action === 'approve') {
				await approveMutation.mutateAsync({
					id: request.id,
					data: {
						approvedAmount: data.approvedAmount!,
						reviewNotes: data.reviewNotes,
					},
				})
				toast.success('Request approved successfully')
			} else if (data.action === 'partially_approve') {
				await partialApproveMutation.mutateAsync({
					id: request.id,
					data: {
						approvedAmount: data.approvedAmount!,
						rejectionReason: data.rejectionReason || 'Partially approved',
						reviewNotes: data.reviewNotes,
					},
				})
				toast.success('Request partially approved')
			} else if (data.action === 'reject') {
				await rejectMutation.mutateAsync({
					id: request.id,
					data: {
						rejectionReason: data.rejectionReason!,
						reviewNotes: data.reviewNotes,
					},
				})
				toast.success('Request rejected')
			}

			onSuccess()
		} catch (error: any) {
			toast.error('Failed to process review', {
				description: error.message || 'Please try again',
			})
		}
	})

	const isPending =
		approveMutation.isPending || partialApproveMutation.isPending || rejectMutation.isPending

	return (
		<Card className="sticky top-4 p-6">
			<form onSubmit={onSubmit} className="space-y-6">
				<h3 className="font-semibold">Review Actions</h3>

				{/* Decision Radio Group */}
				<div className="space-y-2">
					<Label>Decision</Label>
					<div className="space-y-2">
						<label className="flex items-center gap-2">
							<input
								type="radio"
								value="approve"
								{...form.register('action')}
								className="h-4 w-4"
							/>
							<span className="text-sm">Approve</span>
						</label>
						<label className="flex items-center gap-2">
							<input
								type="radio"
								value="partially_approve"
								{...form.register('action')}
								className="h-4 w-4"
							/>
							<span className="text-sm">Partially Approve</span>
						</label>
						<label className="flex items-center gap-2">
							<input type="radio" value="reject" {...form.register('action')} className="h-4 w-4" />
							<span className="text-sm">Reject</span>
						</label>
					</div>
				</div>

				{/* Approved Amount (for approve/partial) */}
				{(action === 'approve' || action === 'partially_approve') && (
					<div>
						<Label htmlFor="approvedAmount">Approved Amount (ISK)</Label>
						<Input id="approvedAmount" type="text" {...form.register('approvedAmount')} />
						{form.formState.errors.approvedAmount && (
							<p className="mt-1 text-xs text-red-500">
								{form.formState.errors.approvedAmount.message}
							</p>
						)}
						<p className="mt-1 text-xs text-muted-foreground">
							Requested: {request.requestedAmount ? formatISK(request.requestedAmount) : '—'} · Ship
							value: {formatISK(request.shipValue)}
						</p>
					</div>
				)}

				{/* Rejection Reason (for partial/reject) */}
				{(action === 'partially_approve' || action === 'reject') && (
					<div>
						<Label htmlFor="rejectionReason">
							{action === 'reject' ? 'Rejection Reason' : 'Reason for Reduction'}
						</Label>
						<Textarea
							id="rejectionReason"
							{...form.register('rejectionReason')}
							placeholder="Explain the reason..."
							rows={3}
						/>
						{form.formState.errors.rejectionReason && (
							<p className="mt-1 text-xs text-red-500">
								{form.formState.errors.rejectionReason.message}
							</p>
						)}
					</div>
				)}

				{/* Internal Notes */}
				<div>
					<Label htmlFor="reviewNotes">Internal Notes (Optional)</Label>
					<Textarea
						id="reviewNotes"
						{...form.register('reviewNotes')}
						placeholder="Notes for other reviewers..."
						rows={3}
					/>
					<p className="mt-1 text-xs text-muted-foreground">
						These notes are only visible to reviewers and admins
					</p>
				</div>

				{/* Confirmation Warning for Rejection */}
				{showConfirm && action === 'reject' && (
					<div className="flex gap-2 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm">
						<AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
						<div>
							<p className="font-medium text-red-500">Confirm Rejection</p>
							<p className="text-muted-foreground">
								Are you sure you want to reject this request? This cannot be undone.
							</p>
						</div>
					</div>
				)}

				{/* Submit Buttons */}
				<div className="flex gap-2">
					<Button type="button" variant="outline" onClick={() => onSuccess()} disabled={isPending}>
						Cancel
					</Button>
					<Button
						type="submit"
						disabled={isPending}
						variant={action === 'reject' ? 'destructive' : 'default'}
					>
						{isPending ? 'Processing...' : showConfirm ? 'Confirm Rejection' : 'Submit Review'}
					</Button>
				</div>
			</form>
		</Card>
	)
}
