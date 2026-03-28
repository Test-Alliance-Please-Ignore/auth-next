import { zodResolver } from '@hookform/resolvers/zod'
import { AlertCircle, Check, X } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { useMarkPaid, useMarkPartiallyPaid } from '../hooks'
import { formatISK } from '../utils'

import type { SRPRequestResponse } from '../types'

const paymentSchema = z.object({
	paymentToken: z.string().length(16, 'Payment token must be 16 characters'),
	paidAmount: z.string().min(1, 'Amount required'),
	notes: z.string().optional(),
})

type PaymentFormData = z.infer<typeof paymentSchema>

interface PaymentFormProps {
	request: SRPRequestResponse
	onSuccess: () => void
	onCancel: () => void
}

export function PaymentForm({ request, onSuccess, onCancel }: PaymentFormProps) {
	const [tokenValidated, setTokenValidated] = useState(false)
	const markPaidMutation = useMarkPaid()
	const markPartiallyPaidMutation = useMarkPartiallyPaid()

	const form = useForm<PaymentFormData>({
		resolver: zodResolver(paymentSchema),
		defaultValues: {
			paymentToken: '',
			paidAmount: request.approvedAmount || '',
			notes: '',
		},
	})

	const watchToken = form.watch('paymentToken')
	const watchAmount = form.watch('paidAmount')

	// Validate token format (client-side only - actual validation is on server)
	const isTokenFormatValid = watchToken.length === 16

	const onSubmit = form.handleSubmit(async (data) => {
		try {
			const approvedAmount = parseFloat(request.approvedAmount || '0')
			const paidAmount = parseFloat(data.paidAmount)

			if (paidAmount >= approvedAmount) {
				// Full payment
				await markPaidMutation.mutateAsync({
					id: request.id,
					data: {
						paymentToken: data.paymentToken,
						paidAmount: data.paidAmount,
					},
				})
				toast.success('Payment recorded successfully')
			} else {
				// Partial payment
				await markPartiallyPaidMutation.mutateAsync({
					id: request.id,
					data: {
						paymentToken: data.paymentToken,
						paidAmount: data.paidAmount,
						notes: data.notes,
					},
				})
				toast.success('Partial payment recorded')
			}

			onSuccess()
		} catch (error: any) {
			toast.error('Failed to record payment', {
				description: error.message || 'Invalid payment token or server error',
			})
		}
	})

	const isPending = markPaidMutation.isPending || markPartiallyPaidMutation.isPending

	return (
		<form onSubmit={onSubmit} className="space-y-6">
			{/* Request Info */}
			<div className="space-y-2 text-sm">
				<div>
					<span className="text-muted-foreground">Pilot:</span> {request.characterName}
				</div>
				<div>
					<span className="text-muted-foreground">Ship:</span> {request.shipTypeName}
				</div>
				<div>
					<span className="text-muted-foreground">Approved Amount:</span>{' '}
					<span className="font-medium tabular-nums">
						{formatISK(request.approvedAmount || '0')}
					</span>
				</div>
			</div>

			{/* Warning */}
			<div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
				<AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
				<div>
					<p className="font-medium text-amber-500">Payment Token Required</p>
					<p className="text-muted-foreground">
						The pilot must provide their payment token to confirm this payment.
					</p>
				</div>
			</div>

			{/* Payment Token */}
			<div>
				<Label htmlFor="paymentToken">Payment Token</Label>
				<div className="relative">
					<Input
						id="paymentToken"
						type="text"
						maxLength={16}
						className="font-mono"
						placeholder="ABCD-1234-EFGH-5678"
						{...form.register('paymentToken')}
					/>
					<div className="absolute right-3 top-1/2 -translate-y-1/2">
						{isTokenFormatValid ? (
							<Check className="h-4 w-4 text-green-500" />
						) : watchToken.length > 0 ? (
							<X className="h-4 w-4 text-red-500" />
						) : null}
					</div>
				</div>
				{form.formState.errors.paymentToken && (
					<p className="mt-1 text-xs text-red-500">{form.formState.errors.paymentToken.message}</p>
				)}
				<p className="mt-1 text-xs text-muted-foreground">
					Must be exactly 16 characters (validation on server)
				</p>
			</div>

			{/* Paid Amount */}
			<div>
				<Label htmlFor="paidAmount">Paid Amount (ISK)</Label>
				<Input id="paidAmount" type="text" {...form.register('paidAmount')} />
				{form.formState.errors.paidAmount && (
					<p className="mt-1 text-xs text-red-500">{form.formState.errors.paidAmount.message}</p>
				)}
				{watchAmount && (
					<p className="mt-1 text-xs text-muted-foreground">
						{parseFloat(watchAmount) < parseFloat(request.approvedAmount || '0')
							? 'Partial payment - can pay remainder later'
							: 'Full payment'}
					</p>
				)}
			</div>

			{/* Notes (optional, for partial payments) */}
			<div>
				<Label htmlFor="notes">Payment Notes (Optional)</Label>
				<Textarea
					id="notes"
					{...form.register('notes')}
					placeholder="Transaction reference, notes..."
					rows={2}
				/>
			</div>

			{/* Submit Buttons */}
			<div className="flex gap-2">
				<Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
					Cancel
				</Button>
				<Button type="submit" disabled={isPending || !isTokenFormatValid}>
					{isPending ? 'Processing...' : 'Confirm Payment'}
				</Button>
			</div>
		</form>
	)
}
