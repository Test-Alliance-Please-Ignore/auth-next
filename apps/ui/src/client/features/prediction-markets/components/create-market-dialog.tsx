import { Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { z } from 'zod'

import { MAX_MARKET_OPEN_DAYS, MAX_MARKET_OPEN_DURATION_MS } from '@repo/prediction-markets'

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
import { useUserPermissions } from '@/hooks/useUserPermissions'
import toast from '@/lib/toast'

import { useCreateMarket } from '../hooks'
import { UserSearchSelect } from './user-search-select'

import type { CreateMarketRequest } from '../types'

const MAX_OUTCOMES = 20

// Client guard mirrors the server route (defense-in-depth; server is authoritative).
const schema = z
	.object({
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
		resolvesOn: z.string().refine((s) => {
			const t = new Date(s).getTime()
			return Number.isFinite(t) && t > Date.now()
		}, 'Resolution date must be in the future'),
		rakeBps: z.number().int().min(0).max(2000).optional(),
		minStake: z.string().optional(),
		maxStake: z.string().optional(),
		perUserCap: z.string().optional(),
		twoOfN: z.boolean().optional(),
		designatedResolverIds: z.array(z.string().uuid()).max(10).optional(),
	})
	// A market can't be scheduled to resolve before its own betting closes (server enforces this too).
	.refine((d) => new Date(d.resolvesOn).getTime() >= new Date(d.closesAt).getTime(), {
		message: 'Resolution date must be on or after the close time',
		path: ['resolvesOn'],
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

/** Format a Date as a `datetime-local` input value (local wall-clock, no timezone). */
function toLocalDatetimeInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
	const [resolvesOn, setResolvesOn] = useState('')
	const [rakeBps, setRakeBps] = useState('')
	const [minStake, setMinStake] = useState('')
	const [maxStake, setMaxStake] = useState('')
	const [perUserCap, setPerUserCap] = useState('')
	const [twoOfN, setTwoOfN] = useState(false)
	// Designated resolvers (admin scope only). A parallel id→label map keeps chip names visible
	// without re-searching. No MultiSelect primitive exists, so we compose one from the single-select
	// UserSearchSelect used as an always-empty "add" picker + removable chips.
	const [resolverIds, setResolverIds] = useState<string[]>([])
	const [resolverLabels, setResolverLabels] = useState<Record<string, string>>({})
	const canDesignate = scope === 'admin'

	// Non-admins are capped at MAX_MARKET_OPEN_DAYS of open time (creation → close); site admins are
	// exempt. Mirrors the server, which is authoritative — this is just UX (hint + soft cap + a `max`
	// on the picker). Applies in either scope: admin-scope callers are always site admins (isAdmin true).
	const { isAdmin } = useUserPermissions()
	const durationCapped = !isAdmin
	const maxCloseLocal = toLocalDatetimeInput(new Date(Date.now() + MAX_MARKET_OPEN_DURATION_MS))

	const create = useCreateMarket(scope)

	useEffect(() => {
		if (open) {
			setQuestion('')
			setDescription('')
			setOutcomes(['Yes', 'No'])
			setClosesAt('')
			setResolvesOn('')
			setRakeBps('')
			setMinStake('')
			setMaxStake('')
			setPerUserCap('')
			setTwoOfN(false)
			setResolverIds([])
			setResolverLabels({})
		}
	}, [open])

	const addResolver = (id: string, labelText: string) => {
		if (!id) return
		setResolverIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
		setResolverLabels((prev) => ({ ...prev, [id]: labelText }))
	}
	const removeResolver = (id: string) => setResolverIds((prev) => prev.filter((r) => r !== id))

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
			resolvesOn,
			rakeBps: rakeBps ? Number(rakeBps) : undefined,
			minStake: minStake || undefined,
			maxStake: maxStake || undefined,
			perUserCap: perUserCap || undefined,
			twoOfN,
			designatedResolverIds: canDesignate && resolverIds.length ? resolverIds : undefined,
		})
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'Invalid market')
			return
		}
		const d = parsed.data

		// Soft-enforce the open-duration cap for non-admins (the server rejects it too, but a clear
		// client message beats a round-trip 400). Admins are exempt.
		if (
			durationCapped &&
			new Date(d.closesAt).getTime() - Date.now() > MAX_MARKET_OPEN_DURATION_MS
		) {
			toast.error(`Markets can stay open for at most ${MAX_MARKET_OPEN_DAYS} days.`)
			return
		}

		const body: CreateMarketRequest = {
			question: d.question,
			outcomes: d.outcomes,
			// datetime-local (local time, no zone) → absolute ISO-8601.
			closesAt: new Date(d.closesAt).toISOString(),
			resolvesOn: new Date(d.resolvesOn).toISOString(),
			twoOfN: d.twoOfN,
		}
		if (d.description) body.description = d.description
		if (d.rakeBps !== undefined) body.rakeBps = d.rakeBps
		if (d.minStake) body.minStake = d.minStake
		if (d.maxStake) body.maxStake = d.maxStake
		if (d.perUserCap) body.perUserCap = d.perUserCap
		if (d.designatedResolverIds?.length) body.designatedResolverIds = d.designatedResolverIds

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
							max={durationCapped ? maxCloseLocal : undefined}
							disabled={create.isPending}
							required
						/>
						{durationCapped ? (
							<p className="text-xs text-muted-foreground">
								Markets can stay open for up to {MAX_MARKET_OPEN_DAYS} days.
							</p>
						) : null}
					</div>

					<div className="space-y-2">
						<Label htmlFor="pm-resolves">Resolves on</Label>
						<Input
							id="pm-resolves"
							type="datetime-local"
							value={resolvesOn}
							onChange={(e) => setResolvesOn(e.target.value)}
							disabled={create.isPending}
							required
						/>
						<p className="text-xs text-muted-foreground">
							Expected resolution date — on or after the close time.
						</p>
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

					{canDesignate ? (
						<div className="space-y-2">
							<Label>Designated resolvers (optional)</Label>
							<p className="text-xs text-muted-foreground">
								Restrict who can resolve or void this market. Each must already hold the resolver
								role; you can’t designate yourself. Leave empty to allow any resolver. Two-of-N
								markets need at least two.
							</p>
							<UserSearchSelect
								value=""
								placeholder="Search resolvers by name…"
								disabled={create.isPending || resolverIds.length >= 10}
								onChange={(id, user) => addResolver(id, user?.label ?? id)}
							/>
							{resolverIds.length > 0 ? (
								<div className="flex flex-wrap gap-2">
									{resolverIds.map((id) => (
										<span
											key={id}
											className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-sm"
										>
											<span className="max-w-[12rem] truncate" title={resolverLabels[id] ?? id}>
												{resolverLabels[id] ?? id}
											</span>
											<button
												type="button"
												onClick={() => removeResolver(id)}
												disabled={create.isPending}
												aria-label={`Remove resolver ${resolverLabels[id] ?? id}`}
												className="text-muted-foreground hover:text-foreground"
											>
												<X className="h-3.5 w-3.5" />
											</button>
										</span>
									))}
								</div>
							) : null}
						</div>
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
