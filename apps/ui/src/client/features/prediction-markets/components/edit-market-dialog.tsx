import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useUpdateMarket } from '../hooks'

import type { UpdateMarketRequest } from '../types'
import type { MarketSummary } from '@repo/prediction-markets'

/** ISO (UTC) → a `datetime-local` value (local wall-clock, minute precision). */
function toLocalInput(iso: string): string {
	const d = new Date(iso)
	const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
	return local.toISOString().slice(0, 16)
}

export interface EditMarketDialogProps {
	/** The market being edited, or null when the dialog is closed. */
	market: MarketSummary | null
	open: boolean
	onOpenChange: (open: boolean) => void
}

/**
 * Edit a market's safe fields (closing time + question). Only fields the admin actually changed are
 * sent; the server refreshes the forum post and announces the change in the thread. Outcomes and
 * economic params are intentionally not editable.
 */
export function EditMarketDialog({ market, open, onOpenChange }: EditMarketDialogProps) {
	const [question, setQuestion] = useState('')
	const [closesAt, setClosesAt] = useState('')
	const [initialClosesAt, setInitialClosesAt] = useState('')
	const update = useUpdateMarket()

	// The close time only governs an open market — the server rejects editing it once betting closed.
	const canEditClose = market?.status === 'open'

	useEffect(() => {
		if (open && market) {
			setQuestion(market.question)
			const local = toLocalInput(market.closesAt)
			setClosesAt(local)
			setInitialClosesAt(local)
		}
	}, [open, market])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!market) return

		// Send only what changed (compare against the prefilled values).
		const body: UpdateMarketRequest = {}
		if (question.trim() !== market.question) body.question = question.trim()
		if (canEditClose && closesAt && closesAt !== initialClosesAt) {
			body.closesAt = new Date(closesAt).toISOString()
		}

		if (Object.keys(body).length === 0) {
			onOpenChange(false) // nothing changed — nothing to do
			return
		}
		await update.mutateAsync({ id: market.id, body })
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Edit market</DialogTitle>
					<DialogDescription>
						Changes are announced in the forum thread and reflected in the post. Outcomes and stakes
						can’t be edited.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="edit-question">Question</Label>
						<Input
							id="edit-question"
							value={question}
							onChange={(e) => setQuestion(e.target.value)}
							maxLength={500}
							disabled={update.isPending}
							required
						/>
					</div>

					{canEditClose ? (
						<div className="space-y-2">
							<Label htmlFor="edit-closes">Closes at</Label>
							<Input
								id="edit-closes"
								type="datetime-local"
								value={closesAt}
								onChange={(e) => setClosesAt(e.target.value)}
								disabled={update.isPending}
								required
							/>
						</div>
					) : null}

					<DialogFooter>
						<Button
							type="button"
							variant="cancel"
							showIcon={false}
							onClick={() => onOpenChange(false)}
							disabled={update.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" variant="primary" loading={update.isPending} loadingText="Saving…">
							Save changes
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
