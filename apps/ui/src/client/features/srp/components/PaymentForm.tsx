import { AlertCircle, Check, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useMarkPaid } from '../hooks'
import { formatISK } from '../utils'

import type { SRPRequestResponse } from '../types'

interface PaymentFormProps {
	request: SRPRequestResponse
	onSuccess: () => void
	onCancel: () => void
}

export function PaymentForm({ request, onSuccess, onCancel }: PaymentFormProps) {
	const [paymentToken, setPaymentToken] = useState('')
	const markPaidMutation = useMarkPaid()

	const isTokenValid = paymentToken.length === 16

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!isTokenValid) return
		try {
			await markPaidMutation.mutateAsync({ id: request.id, paymentToken })
			toast.success('Payment recorded successfully')
			onSuccess()
		} catch (error: any) {
			toast.error('Failed to record payment', { description: error.message })
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
			<div className="space-y-1 text-sm">
				<div>
					<span className="text-muted-foreground">Pilot:</span> {request.characterName}
				</div>
				<div>
					<span className="text-muted-foreground">Ship:</span> {request.shipTypeName}
				</div>
				<div>
					<span className="text-muted-foreground">Amount:</span>{' '}
					<span className="font-medium">{formatISK(request.approvedAmount ?? '0')}</span>
				</div>
			</div>

			<div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
				<AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
				<p className="text-muted-foreground">Enter the pilot's payment token to confirm payment.</p>
			</div>

			<div>
				<Label htmlFor="paymentToken">Payment Token</Label>
				<div className="relative">
					<Input
						id="paymentToken"
						type="text"
						maxLength={16}
						className="font-mono"
						placeholder="16 characters"
						value={paymentToken}
						onChange={(e) => setPaymentToken(e.target.value)}
					/>
					<div className="absolute right-3 top-1/2 -translate-y-1/2">
						{isTokenValid ? (
							<Check className="h-4 w-4 text-green-500" />
						) : paymentToken.length > 0 ? (
							<X className="h-4 w-4 text-red-500" />
						) : null}
					</div>
				</div>
			</div>

			<div className="flex gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={onCancel}
					disabled={markPaidMutation.isPending}
				>
					Cancel
				</Button>
				<Button type="submit" disabled={markPaidMutation.isPending || !isTokenValid}>
					{markPaidMutation.isPending ? 'Processing…' : 'Confirm Payment'}
				</Button>
			</div>
		</form>
	)
}
