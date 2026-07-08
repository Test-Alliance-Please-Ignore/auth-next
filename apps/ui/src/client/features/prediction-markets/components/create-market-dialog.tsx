import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'

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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import toast from '@/lib/toast'

import { useCreateMarket } from '../hooks'

import type { CreateMarketRequest } from '../types'

const MAX_OUTCOMES = 20

// Client guard mirrors the server route (defense-in-depth; server is authoritative).
const schema = z.object({
	question: z.string().trim().min(3, 'Question must be at least 3 characters').max(500),
	description: z.string().trim().max(2000).optional(),
	outcomes: z
		.array(z.string().trim().min(1))
		.min(2, 'Add at least two outcomes')
		.max(MAX_OUTCOMES)
		.refine(
			(o) => new Set(o.map((s) => s.toLowerCase())).size === o.length,
			'Outcomes must be distinct'
		),
	closesAt: z.string().refine((s) => {
		const t = new Date(s).getTime()
		return Number.isFinite(t) && t > Date.now()
	}, 'Close time must be in the future'),
	rakeBps: z.number().int().min(0).max(2000).optional(),
	minStake: z.string().optional(),
	maxStake: z.string().optional(),
	perUserCap: z.string().optional(),
	twoOfN: z.boolean().optional(),
})

export interface CreateMarketDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Which endpoint to create through: 'admin' (default) or 'member' (urn:markets:creator). */
	scope?: 'admin' | 'member'
	/**
	 * Show the economic params (rake / stakes / cap / two-of-N). Default true. Hidden for a
	 * lower-trust `urn:markets:creator` — the server strips those anyway and defaults from config,
	 * so showing them would just be ignored input.
	 */
	showAdvanced?: boolean
}

const digitsOnly = (v: string) => v.replace(/\D/g, '')

export function CreateMarketDialog({
	open,
	onOpenChange,
	scope = 'admin',
	showAdvanced = true,
}: CreateMarketDialogProps) {
	const [question, setQuestion] = useState('')
	const [description, setDescription] = useState('')
	const [outcomes, setOutcomes] = useState<string[]>(['Yes', 'No'])
	const [closesAt, setClosesAt] = useState('')
	const [rakeBps, setRakeBps] = useState('')
	const [minStake, setMinStake] = useState('')
	const [maxStake, setMaxStake] = useState('')
	const [perUserCap, setPerUserCap] = useState('')
	const [twoOfN, setTwoOfN] = useState(false)

	const create = useCreateMarket(scope)

	useEffect(() => {
		if (open) {
			setQuestion('')
			setDescription('')
			setOutcomes(['Yes', 'No'])
			setClosesAt('')
			setRakeBps('')
			setMinStake('')
			setMaxStake('')
			setPerUserCap('')
			setTwoOfN(false)
		}
	}, [open])

	const close = () => onOpenChange(false)

	const setOutcome = (i: number, value: string) =>
		setOutcomes((prev) => prev.map((o, idx) => (idx === i ? value : o)))
	const addOutcome = () =>
		setOutcomes((prev) => (prev.length >= MAX_OUTCOMES ? prev : [...prev, '']))
	const removeOutcome = (i: number) =>
		setOutcomes((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		const trimmedOutcomes = outcomes.map((o) => o.trim()).filter(Boolean)
		const parsed = schema.safeParse({
			question,
			description: description.trim() || undefined,
			outcomes: trimmedOutcomes,
			closesAt,
			rakeBps: rakeBps ? Number(rakeBps) : undefined,
			minStake: minStake || undefined,
			maxStake: maxStake || undefined,
			perUserCap: perUserCap || undefined,
			twoOfN,
		})
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Invalid market')
			return
		}
		const d = parsed.data

		const body: CreateMarketRequest = {
			question: d.question,
			outcomes: d.outcomes,
			// datetime-local (local time, no zone) → absolute ISO-8601.
			closesAt: new Date(d.closesAt).toISOString(),
			twoOfN: d.twoOfN,
		}
		if (d.description) body.description = d.description
		if (d.rakeBps !== undefined) body.rakeBps = d.rakeBps
		if (d.minStake) body.minStake = d.minStake
		if (d.maxStake) body.maxStake = d.maxStake
		if (d.perUserCap) body.perUserCap = d.perUserCap

		// Success/error toast handled by useCreateMarket; close only on success.
		await create.mutateAsync(body)
		close()
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>New market</DialogTitle>
					<DialogDescription>
						Creates the market and posts it to the predictions forum channel.
					</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="pm-question">Question</Label>
						<Input
							id="pm-question"
							placeholder="Will X happen by Y?"
							value={question}
							onChange={(e) => setQuestion(e.target.value)}
							maxLength={500}
							disabled={create.isPending}
							required
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-description">Description (optional)</Label>
						<Textarea
							id="pm-description"
							placeholder="Resolution criteria, context…"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={2}
							maxLength={2000}
							disabled={create.isPending}
						/>
					</div>

					<div className="space-y-2">
						<Label>Outcomes</Label>
						<div className="space-y-2">
							{outcomes.map((outcome, i) => (
								<div key={i} className="flex items-center gap-2">
									<Input
										placeholder={`Outcome ${i + 1}`}
										value={outcome}
										onChange={(e) => setOutcome(i, e.target.value)}
										maxLength={100}
										disabled={create.isPending}
									/>
									<Button
										type="button"
										variant="cancel"
										showIcon={false}
										size="icon"
										onClick={() => removeOutcome(i)}
										disabled={create.isPending || outcomes.length <= 2}
										aria-label={`Remove outcome ${i + 1}`}
									>
										<X className="h-4 w-4" />
									</Button>
								</div>
							))}
						</div>
						<Button
							type="button"
							variant="secondary"
							showIcon={false}
							size="sm"
							onClick={addOutcome}
							disabled={create.isPending || outcomes.length >= MAX_OUTCOMES}
						>
							<Plus className="mr-1 h-4 w-4" /> Add outcome
						</Button>
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-closes">Closes at</Label>
						<Input
							id="pm-closes"
							type="datetime-local"
							value={closesAt}
							onChange={(e) => setClosesAt(e.target.value)}
							disabled={create.isPending}
							required
						/>
					</div>

					{showAdvanced ? (
						<>
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-2">
									<Label htmlFor="pm-rake">Rake (bps, optional)</Label>
									<Input
										id="pm-rake"
										type="text"
										inputMode="numeric"
										placeholder="default"
										value={rakeBps}
										onChange={(e) => setRakeBps(digitsOnly(e.target.value))}
										disabled={create.isPending}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="pm-min">Min stake (optional)</Label>
									<Input
										id="pm-min"
										type="text"
										inputMode="numeric"
										placeholder="default"
										value={minStake}
										onChange={(e) => setMinStake(digitsOnly(e.target.value))}
										disabled={create.isPending}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="pm-max">Max stake (optional)</Label>
									<Input
										id="pm-max"
										type="text"
										inputMode="numeric"
										placeholder="none"
										value={maxStake}
										onChange={(e) => setMaxStake(digitsOnly(e.target.value))}
										disabled={create.isPending}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="pm-cap">Per-user cap (optional)</Label>
									<Input
										id="pm-cap"
										type="text"
										inputMode="numeric"
										placeholder="none"
										value={perUserCap}
										onChange={(e) => setPerUserCap(digitsOnly(e.target.value))}
										disabled={create.isPending}
									/>
								</div>
							</div>

							<div className="flex items-center justify-between rounded-md border border-border p-3">
								<div>
									<Label htmlFor="pm-twoofn">Require two-of-N resolution</Label>
									<p className="text-xs text-muted-foreground">
										A second resolver must approve before this market resolves.
									</p>
								</div>
								<Switch
									id="pm-twoofn"
									checked={twoOfN}
									onCheckedChange={setTwoOfN}
									disabled={create.isPending}
								/>
							</div>
						</>
					) : null}

					<DialogFooter>
						<Button
							type="button"
							variant="cancel"
							showIcon={false}
							onClick={close}
							disabled={create.isPending}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							variant="primary"
							loading={create.isPending}
							loadingText="Creating…"
						>
							Create market
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
