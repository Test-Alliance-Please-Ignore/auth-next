import { useEffect, useState } from 'react'
import { z } from 'zod'

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useConfirmationDialog } from '@/hooks/useConfirmationDialog'
import { formatPoints } from '@/lib/format-utils'
import toast from '@/lib/toast'

import { useDeposit } from '../hooks'
import { UserSearchSelect } from './user-search-select'

// Client-side guard mirrors the server: string-preserving, digits-only, positive.
const depositSchema = z.object({
	targetUserId: z.string().uuid('Select a recipient'),
	amount: z
		.string()
		.regex(/^\d+$/, 'Amount must be a whole number')
		.refine((v) => /[1-9]/.test(v), 'Amount must be greater than 0'),
	reason: z.string().trim().min(3, 'Reason must be at least 3 characters'),
})

export interface DepositDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** When set, the recipient is pre-filled and locked (opened from a specific wallet). */
	defaultTargetUserId?: string
	defaultTargetName?: string | null
}

export function DepositDialog({
	open,
	onOpenChange,
	defaultTargetUserId,
	defaultTargetName,
}: DepositDialogProps) {
	const [targetUserId, setTargetUserId] = useState(defaultTargetUserId ?? '')
	const [targetLabel, setTargetLabel] = useState<string | null>(defaultTargetName ?? null)
	const [amount, setAmount] = useState('')
	const [reason, setReason] = useState('')

	const deposit = useDeposit()
	const { requestConfirmation, confirmationDialog } = useConfirmationDialog()

	// Reset fields whenever the dialog opens (and pick up a new default target).
	useEffect(() => {
		if (open) {
			setTargetUserId(defaultTargetUserId ?? '')
			setTargetLabel(defaultTargetName ?? null)
			setAmount('')
			setReason('')
		}
	}, [open, defaultTargetUserId, defaultTargetName])

	const close = () => onOpenChange(false)

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		const parsed = depositSchema.safeParse({ targetUserId, amount, reason })
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Invalid deposit')
			return
		}
		const data = parsed.data

		requestConfirmation({
			title: 'Confirm deposit',
			description: `Deposit ${formatPoints(data.amount)} to this wallet? This cannot be undone.`,
			confirmLabel: 'Deposit',
			cancelLabel: 'Cancel',
			intent: 'destructive',
			confirmButtonVariant: 'danger',
			confirmDelaySeconds: 5,
			onConfirm: async () => {
				// A fresh idempotency key per confirmed submit dedupes accidental double-delivery.
				await deposit.mutateAsync({
					targetUserId: data.targetUserId,
					amount: data.amount,
					reason: data.reason,
					idempotencyKey: crypto.randomUUID(),
				})
				// Success toast is handled by useDeposit (useApiMutation). Close on success;
				// a rejection propagates and keeps the confirmation dialog open (already toasted).
				close()
			},
		})
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Deposit points</DialogTitle>
					<DialogDescription>Credit a member&apos;s prediction-market wallet.</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="pm-deposit-user">Recipient</Label>
						<UserSearchSelect
							inputId="pm-deposit-user"
							value={targetUserId}
							label={targetLabel}
							disabled={deposit.isPending || !!defaultTargetUserId}
							onChange={(userId, user) => {
								setTargetUserId(userId)
								setTargetLabel(user?.label ?? null)
							}}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-deposit-amount">Amount</Label>
						<Input
							id="pm-deposit-amount"
							type="text"
							inputMode="numeric"
							pattern="\d*"
							placeholder="1000"
							value={amount}
							onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
							disabled={deposit.isPending}
							required
						/>
						<p className="text-xs text-muted-foreground">Whole points only.</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-deposit-reason">Reason</Label>
						<Textarea
							id="pm-deposit-reason"
							placeholder="Reason for this deposit (min 3 characters)"
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							rows={3}
							minLength={3}
							maxLength={500}
							disabled={deposit.isPending}
							required
						/>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="cancel"
							showIcon={false}
							onClick={close}
							disabled={deposit.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							loading={deposit.isPending}
							loadingText="Depositing…"
						>
							Review deposit
						</Button>
					</DialogFooter>
				</form>

				{confirmationDialog}
			</DialogContent>
		</Dialog>
	)
}
